// Aushilfenabrechnung: Daten laden, Lauf anlegen, festschreiben, stornieren, Zahlungen buchen (ohne Next.js, direkt testbar).
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { amount, employmentLimitHints, paymentStatus, preparePayroll, type PayEmployee, type PaySource, type Wage } from "./calc/payroll";
import { dbDate } from "./time";

type Db = PrismaClient | Prisma.TransactionClient;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const PAID_ABSENCE = ["SICK", "VACATION", "SPECIAL_LEAVE"] as const; // Kind krank zahlt die Krankenkasse, unbezahlt/Freizeitausgleich nicht

export async function loadOpenPayroll(db: Db, cutoff: string): Promise<PayEmployee[]> {
  const emps = await db.employee.findMany({ where: { contracts: { some: { payModel: "HOURLY" } } }, include: { contracts: true, wages: true } });
  const ids = emps.map((e) => e.id);
  const hourlyAt = new Map(emps.map((e) => [e.id, (d: string) => e.contracts.some((c) => c.payModel === "HOURLY" && ymd(c.validFrom) <= d && (!c.validTo || ymd(c.validTo) >= d))]));
  const [sessions, absDays, settledItems] = await Promise.all([
    db.workSession.findMany({ where: { employeeId: { in: ids }, workDate: { lte: dbDate(cutoff) } }, select: { id: true, employeeId: true, workDate: true, status: true, payableMinutes: true } }),
    db.absenceDay.findMany({ where: { date: { lte: dbDate(cutoff) }, creditedMinutes: { gt: 0 }, absence: { employeeId: { in: ids }, status: { not: "CANCELLED" }, type: { in: [...PAID_ABSENCE] } } }, select: { id: true, date: true, creditedMinutes: true, absence: { select: { employeeId: true } } } }),
    db.payrollItem.findMany({ where: { employeeId: { in: ids }, period: { status: { in: ["PREPARED", "SETTLED"] } } }, select: { workSessionId: true, absenceDayId: true, minutes: true } }),
  ]);
  const settled = new Map<string, number>();
  for (const i of settledItems) {
    const k = i.workSessionId ? `WORK:${i.workSessionId}` : `PAID_ABSENCE:${i.absenceDayId}`;
    settled.set(k, (settled.get(k) ?? 0) + i.minutes);
  }
  const sources: PaySource[] = [
    ...sessions.filter((s) => hourlyAt.get(s.employeeId)!(ymd(s.workDate))).map((s) => ({ kind: "WORK" as const, sourceId: s.id, employeeId: s.employeeId, workDate: ymd(s.workDate), minutes: s.status === "CLOSED" ? s.payableMinutes : 0, open: s.status !== "CLOSED" })),
    ...absDays.filter((a) => hourlyAt.get(a.absence.employeeId)!(ymd(a.date))).map((a) => ({ kind: "PAID_ABSENCE" as const, sourceId: a.id, employeeId: a.absence.employeeId, workDate: ymd(a.date), minutes: a.creditedMinutes })),
  ];
  const wages = new Map<string, Wage[]>(emps.map((e) => [e.id, e.wages.map((w) => ({ validFrom: ymd(w.validFrom), validTo: w.validTo ? ymd(w.validTo) : null, centsPerHour: w.centsPerHour }))]));
  const result = preparePayroll(cutoff, sources, settled, wages);
  // Hinweise zu Minijob-Verdienstgrenze und 70-Tage-Grenze (kurzfristige Beschäftigung) – nur Warnung, nichts wird blockiert
  const rate = (id: string, d: string) => wages.get(id)?.find((w) => w.validFrom <= d && (!w.validTo || w.validTo >= d))?.centsPerHour ?? 0;
  for (const e of emps) {
    const own = sources.filter((x) => x.employeeId === e.id && !x.open);
    const hints = employmentLimitHints(e.employmentType, cutoff, own.map((x) => ({ workDate: x.workDate, kind: x.kind, cents: amount(x.minutes, rate(e.id, x.workDate)) })));
    if (!hints.length) continue;
    let row = result.find((r) => r.employeeId === e.id);
    if (!row) { row = { employeeId: e.id, items: [], minutes: 0, grossCents: 0, carryMinutes: 0, carryCents: 0, blockers: [], hints: [] }; result.push(row); }
    row.hints.push(...hints);
  }
  return result;
}

export async function createPayrollPeriod(adminId: string, cutoff: string, label: string): Promise<{ ok?: string; error?: string; id?: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll'))`;
    if (await tx.payrollPeriod.findFirst({ where: { status: "PREPARED" } })) return { error: "Es gibt schon einen vorbereiteten Lauf. Bitte diesen zuerst festschreiben oder stornieren." };
    const open = (await loadOpenPayroll(tx, cutoff)).filter((e) => !e.blockers.length && e.items.length);
    if (!open.length) return { error: "Bis zu diesem Stichtag gibt es keine offenen Aushilfenstunden." };
    const p = await tx.payrollPeriod.create({ data: { cutoffDate: dbDate(cutoff), label, createdById: adminId } });
    for (const e of open) {
      const s = await tx.payrollSettlement.create({ data: { periodId: p.id, employeeId: e.employeeId, minutes: e.minutes, grossCents: e.grossCents, status: "PREPARED" } });
      await tx.payrollItem.createMany({
        data: e.items.map((i) => ({ periodId: p.id, settlementId: s.id, employeeId: e.employeeId, kind: i.kind, workSessionId: i.sourceKind === "WORK" ? i.sourceId : null, absenceDayId: i.sourceKind === "PAID_ABSENCE" ? i.sourceId : null, workDate: dbDate(i.workDate), minutes: i.minutes, centsPerHour: i.centsPerHour, amountCents: i.amountCents, isCarryOver: i.isCarryOver })),
      });
    }
    const gross = open.reduce((a, e) => a + e.grossCents, 0);
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "PAYROLL_PREPARED", entityType: "PayrollPeriod", entityId: p.id, after: { cutoff, employees: open.length, grossCents: gross } });
    return { ok: `Abrechnung vorbereitet: ${open.length} Aushilfen.`, id: p.id };
  });
}

export async function settlePayrollPeriod(adminId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.payrollPeriod.findUniqueOrThrow({ where: { id } });
    if (p.status !== "PREPARED") return { error: "Dieser Lauf ist nicht mehr im Status „vorbereitet“." };
    await tx.payrollPeriod.update({ where: { id }, data: { status: "SETTLED", settledAt: new Date(), settledById: adminId } });
    await tx.payrollSettlement.updateMany({ where: { periodId: id, status: "PREPARED" }, data: { status: "SETTLED" } });
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "PAYROLL_SETTLED", entityType: "PayrollPeriod", entityId: id });
    return { ok: "Abrechnung festgeschrieben. Die Stunden gelten jetzt als abgerechnet." };
  });
}

export async function cancelPayrollPeriod(adminId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.payrollPeriod.findUniqueOrThrow({ where: { id } });
    if (p.status !== "PREPARED") return { error: "Nur ein vorbereiteter Lauf kann storniert werden. Festgeschriebene Abrechnungen bleiben; Korrekturen erscheinen im nächsten Lauf als Differenz." };
    await tx.payrollPeriod.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "PAYROLL_CANCELLED", entityType: "PayrollPeriod", entityId: id });
    return { ok: "Lauf storniert. Die Stunden sind wieder offen." };
  });
}

/** Zahlung buchen oder stornieren (reverseId: Zahlung wird als storniert markiert, bleibt aber sichtbar) */
export async function recordPayment(adminId: string, settlementId: string, amountCents: number, paidOn: string, reference: string | null, reverseId?: string) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.payrollSettlement.findUniqueOrThrow({ where: { id: settlementId }, include: { period: true, payments: true } });
    if (s.period.status !== "SETTLED") return { error: "Bitte die Abrechnung zuerst festschreiben." };
    const valid = s.payments.filter((p) => !p.reversedById);
    let paid = valid.reduce((a, p) => a + p.amountCents, 0);
    let entityId: string;
    if (reverseId) {
      const orig = valid.find((p) => p.id === reverseId);
      if (!orig) return { error: "Diese Zahlung kann nicht storniert werden." };
      await tx.paymentRecord.update({ where: { id: reverseId }, data: { reversedById: adminId } });
      paid -= orig.amountCents;
      entityId = orig.id;
    } else {
      if (!(amountCents > 0)) return { error: "Bitte einen Betrag angeben." };
      if (paid + amountCents > s.grossCents) return { error: "Der Betrag ist höher als der noch offene Betrag." };
      entityId = (await tx.paymentRecord.create({ data: { employeeId: s.employeeId, settlementId, amountCents, paidOn: dbDate(paidOn), reference, createdById: adminId } })).id;
      paid += amountCents;
    }
    await tx.payrollSettlement.update({ where: { id: settlementId }, data: { status: paymentStatus(s.grossCents, paid, true) } });
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: reverseId ? "PAYMENT_REVERSED" : "PAYMENT_RECORDED", entityType: "PaymentRecord", entityId, employeeId: s.employeeId, after: reverseId ? { reversed: true } : { amountCents, paidOn, reference } });
    return { ok: reverseId ? "Zahlung storniert." : "Zahlung gebucht." };
  });
}

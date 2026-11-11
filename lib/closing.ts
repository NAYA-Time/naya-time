// Kern des Monatsabschlusses (ohne Next.js), damit er direkt gegen die Datenbank getestet werden kann.
import type { AccountTxType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { monthBounds, prevMonth, type Decision, type MonthResult } from "./calc/month";
import { loadMonth } from "./month-data";
import { dbDate, fmtMinutes } from "./time";

export const DECISIONS: Decision[] = ["AUTO_BOOKED", "EMPLOYEE_CAUSED", "EMPLOYER_CAUSED"];
export const monthLabel = (m: string) => new Date(m + "-15T12:00:00Z").toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

function closingData(r: MonthResult, contractSnapshot: unknown) {
  return {
    targetMinutes: r.target, avgContractMinutes: r.avgContract, workedMinutes: r.worked, sickCreditMinutes: r.sick, vacationCreditMinutes: r.vacation,
    holidayCreditMinutes: r.holiday, otherCreditMinutes: r.other, plannedMinutes: r.planned, overtimeMinutes: r.overtime, includedOvertimeMinutes: r.included,
    compensableMinutes: r.compensable, deficitMinutes: r.deficit, deficitDecision: r.decision, minusMinutesBooked: r.minusBooked,
    accountChangeMinutes: r.accountChange, balanceBeforeMinutes: r.balanceBefore, balanceAfterMinutes: r.balanceAfter,
    ruleSnapshot: { ...(contractSnapshot as object), timeOffMinutes: r.timeOff, holidays: r.holidays, hints: r.hints } as Prisma.InputJsonValue,
  };
}

async function snapshot(tx: Prisma.TransactionClient, employeeId: string, month: string) {
  const { first, last } = monthBounds(month);
  const [contracts, rules] = await Promise.all([
    tx.employeeContract.findMany({ where: { employeeId, validFrom: { lte: dbDate(last) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(first) } }] } }),
    tx.overtimeRule.findMany({ where: { employeeId, validFrom: { lte: dbDate(last) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(first) } }] } }),
  ]);
  return { contracts: contracts.map((c) => ({ id: c.id, validFrom: c.validFrom, weeklyMinutes: c.weeklyMinutes, method: c.monthlyTargetMethod, workdaysMask: c.workdaysMask })), overtimeRules: rules.map((r) => ({ id: r.id, includedMinutesPerMonth: r.includedMinutesPerMonth, contractuallyAgreed: r.contractuallyAgreed })) };
}

/** Kontobuchungen eines Abschlusses: Monatsergebnis und ggf. Freizeitausgleich getrennt, damit das Konto nachvollziehbar bleibt */
async function bookTransactions(tx: Prisma.TransactionClient, accountId: string, closingId: string, r: MonthResult, adminId: string, type: AccountTxType, reason: string, minutes: number, timeOff: number) {
  if (minutes) await tx.workingTimeTransaction.create({ data: { accountId, closingId, bookingDate: dbDate(r.last), type, minutes, reason, createdById: adminId } });
  if (timeOff) await tx.workingTimeTransaction.create({ data: { accountId, closingId, bookingDate: dbDate(r.last), type: "TIME_OFF", minutes: -timeOff, reason: `Freizeitausgleich ${monthLabel(r.month)}`, createdById: adminId } });
}

export async function closeEmployeeMonth(adminId: string, employeeId: string, month: string, decision?: Decision): Promise<{ ok: true; r: MonthResult } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"closing:" + employeeId}))`;
    const { first } = monthBounds(month);
    const existing = await tx.monthlyTimeClosing.findFirst({ where: { employeeId, status: { not: "SUPERSEDED" }, month: { gte: dbDate(first) } }, orderBy: { month: "asc" } });
    if (existing) return { ok: false as const, error: existing.month.getTime() === dbDate(first).getTime() ? "Dieser Monat ist bereits abgeschlossen." : "Ein späterer Monat ist schon abgeschlossen. Frühere Monate bitte über „Korrigieren“ ändern." };
    const anyEarlier = await tx.monthlyTimeClosing.findFirst({ where: { employeeId, status: { not: "SUPERSEDED" }, month: { lt: dbDate(first) } } });
    if (anyEarlier) {
      const prev = await tx.monthlyTimeClosing.findFirst({ where: { employeeId, status: { not: "SUPERSEDED" }, month: dbDate(prevMonth(month) + "-01") } });
      if (!prev) return { ok: false as const, error: `Bitte zuerst ${monthLabel(prevMonth(month))} abschließen. Monate werden lückenlos der Reihe nach abgeschlossen.` };
    }
    if (!anyEarlier) {
      // Erster Abschluss: Es darf kein früherer Monat mit Stempelungen oder Abwesenheiten übersprungen werden
      const [ws, ab] = await Promise.all([
        tx.workSession.findFirst({ where: { employeeId, workDate: { lt: dbDate(first) } }, orderBy: { workDate: "asc" }, select: { workDate: true } }),
        tx.absenceDay.findFirst({ where: { date: { lt: dbDate(first) }, absence: { employeeId, status: { not: "CANCELLED" } } }, orderBy: { date: "asc" }, select: { date: true } }),
      ]);
      const earliest = [ws?.workDate, ab?.date].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
      if (earliest) return { ok: false as const, error: `Es gibt schon Buchungen ab ${monthLabel(earliest.toISOString().slice(0, 7))}. Bitte mit diesem Monat beginnen – sonst würden frühere Monate nie abgerechnet.` };
    }
    const r = await loadMonth(tx, employeeId, month, decision);
    if (r.blockers.length) return { ok: false as const, error: r.blockers.join(" · ") };
    const account = await tx.workingTimeAccount.upsert({ where: { employeeId }, create: { employeeId, openedAt: dbDate(first) }, update: {} });
    const c = await tx.monthlyTimeClosing.create({ data: { employeeId, month: dbDate(first), version: 1, status: "CLOSED", closedById: adminId, closedAt: new Date(), ...closingData(r, await snapshot(tx, employeeId, month)) } });
    await bookTransactions(tx, account.id, c.id, r, adminId, "MONTH_CLOSING", `Monatsabschluss ${monthLabel(month)}`, r.accountChange + r.timeOff, r.timeOff);
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "MONTH_CLOSED", entityType: "MonthlyTimeClosing", entityId: c.id, employeeId, after: { month, target: r.target, actual: r.actual, accountChange: r.accountChange, decision: r.decision, balanceAfter: r.balanceAfter } });
    return { ok: true as const, r };
  });
}

/** Abgeschlossenen Monat korrigieren: neue Version, alte bleibt sichtbar, Konto bekommt nur die Differenz */
export async function correctEmployeeClosing(admin: { id: string }, id: string, reason: string, decision?: Decision): Promise<{ ok?: string; error?: string }> {
  if (reason.length < 5) return { error: "Bitte einen Grund für die Korrektur angeben." };
  return prisma.$transaction(async (tx) => {
    const old = await tx.monthlyTimeClosing.findUniqueOrThrow({ where: { id } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"closing:" + old.employeeId}))`;
    const fresh = await tx.monthlyTimeClosing.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== "CLOSED") return { error: "Dieser Stand wurde schon ersetzt. Bitte Seite neu laden." };
    const month = old.month.toISOString().slice(0, 7);
    const r = await loadMonth(tx, old.employeeId, month, decision && DECISIONS.includes(decision) ? decision : old.deficitDecision !== "NONE" && old.deficitDecision !== "PENDING" ? (old.deficitDecision as Decision) : undefined);
    const blockers = r.blockers.filter((b) => !b.startsWith("Der Monat"));
    if (blockers.length) return { error: blockers.join(" · ") };
    const oldTimeOff = Number((old.ruleSnapshot as { timeOffMinutes?: number } | null)?.timeOffMinutes ?? 0);
    const deltaResult = r.accountChange + r.timeOff - (old.accountChangeMinutes + oldTimeOff);
    const deltaTimeOff = r.timeOff - oldTimeOff;
    await tx.monthlyTimeClosing.update({ where: { id }, data: { status: "SUPERSEDED" } });
    const c = await tx.monthlyTimeClosing.create({ data: { employeeId: old.employeeId, month: old.month, version: old.version + 1, status: "CLOSED", closedById: admin.id, closedAt: new Date(), supersedesId: old.id, correctionReason: reason, ...closingData(r, await snapshot(tx, old.employeeId, month)) } });
    const account = await tx.workingTimeAccount.findUniqueOrThrow({ where: { employeeId: old.employeeId } });
    await bookTransactions(tx, account.id, c.id, r, admin.id, "CLOSING_CORRECTION", `Korrektur ${monthLabel(month)}: ${reason}`, deltaResult, deltaTimeOff);
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "MONTH_CORRECTED", entityType: "MonthlyTimeClosing", entityId: c.id, employeeId: old.employeeId, before: { version: old.version, accountChange: old.accountChangeMinutes }, after: { version: c.version, accountChange: r.accountChange, reason } });
    return { ok: `Korrigiert (Version ${c.version}). Kontoänderung gegenüber vorher ${r.accountChange - old.accountChangeMinutes >= 0 ? "+" : ""}${fmtMinutes(r.accountChange - old.accountChangeMinutes)}.` };
  });
}


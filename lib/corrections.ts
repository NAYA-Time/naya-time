// Korrekturen an Arbeitszeiten. Rohbuchungen bleiben unverändert; jede Korrektur ist ein eigener, unveränderlicher Datensatz.
// Die Schicht wird aus Rohbuchung + jeweils letzter Korrektur je Feld neu berechnet.
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { computeSession } from "./calc/session";
import { berlinDate, berlinTime, berlinToInstant, dbDate } from "./time";
import { findShift } from "./stamp";

type Tx = Prisma.TransactionClient;
type Field = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_MINUTES" | "SESSION_VOID" | "ADD_SESSION";

export async function recomputeSession(tx: Tx, id: string) {
  const s = await tx.workSession.findUniqueOrThrow({ where: { id }, include: { clockInEvent: true, clockOutEvent: true, breaks: true, corrections: { orderBy: { createdAt: "asc" } } } });
  const latest = new Map<string, string>();
  for (const c of s.corrections) latest.set(c.field, c.correctedValue); // spätere Korrektur gewinnt
  const now = new Date();
  if (latest.get("SESSION_VOID") === "true") {
    return tx.workSession.update({ where: { id }, data: { status: "CLOSED", presenceMinutes: 0, breakMinutes: 0, workedMinutes: 0, payableMinutes: 0, lateMinutes: 0, earlyArrivalMinutes: 0, overrunMinutes: 0, computedAt: now } });
  }
  const clockIn = latest.has("CLOCK_IN") ? new Date(latest.get("CLOCK_IN")!) : s.clockInEvent?.effectiveAt;
  if (!clockIn) throw new Error("Schicht ohne Beginn");
  const clockOut = latest.has("CLOCK_OUT") ? new Date(latest.get("CLOCK_OUT")!) : s.clockOutEvent?.effectiveAt ?? null;
  if (!clockOut) return s; // weiterhin offen
  const breaks = latest.has("BREAK_MINUTES") ? [{ minutes: Number(latest.get("BREAK_MINUTES")) }] : s.breaks.map((b) => ({ minutes: b.minutes }));
  const r = computeSession({ clockIn, clockOut, plannedStart: s.plannedStartAt, plannedEnd: s.plannedEndAt, breaks, earlyStartApproved: s.earlyStartApproved });
  return tx.workSession.update({
    where: { id },
    data: {
      status: "CLOSED", effectiveStartAt: r.effectiveStart, effectiveEndAt: r.effectiveEnd, presenceMinutes: r.presenceMinutes, breakMinutes: r.breakMinutes,
      workedMinutes: r.workedMinutes, payableMinutes: r.payableMinutes, lateMinutes: r.lateMinutes, earlyArrivalMinutes: r.earlyArrivalMinutes, overrunMinutes: r.overrunMinutes, computedAt: now,
    },
  });
}

export interface CorrectionInput { clockIn?: string; clockOut?: string; breakMinutes?: number | null; voidSession?: boolean; reason: string }

/** clockIn/clockOut als "HH:MM" bezogen auf den Arbeitstag; Ende vor Beginn = nächster Tag */
export async function correctSession(adminId: string, sessionId: string, input: CorrectionInput): Promise<{ ok?: string; error?: string; warning?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) return { error: "Bitte einen Grund für die Korrektur angeben (mind. 5 Zeichen)." };
  return prisma.$transaction(async (tx) => {
    const s = await tx.workSession.findUniqueOrThrow({ where: { id: sessionId }, include: { clockInEvent: true, clockOutEvent: true, breaks: true, corrections: { orderBy: { createdAt: "asc" } } } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s.employeeId}))`;
    if (s.status === "OPEN" && !input.voidSession && !input.clockOut) return { error: "Die Schicht läuft noch. Bitte ein Ende angeben oder den Mitarbeiter ausstempeln lassen." };
    const day = berlinDate(s.workDate);
    const cur = new Map<string, { id: string; value: string }>();
    for (const c of s.corrections) cur.set(c.field, { id: c.id, value: c.correctedValue });
    const currentIn = cur.has("CLOCK_IN") ? new Date(cur.get("CLOCK_IN")!.value) : s.clockInEvent!.effectiveAt;
    const currentOut = cur.has("CLOCK_OUT") ? new Date(cur.get("CLOCK_OUT")!.value) : s.clockOutEvent?.effectiveAt ?? null;
    const currentBreak = cur.has("BREAK_MINUTES") ? Number(cur.get("BREAK_MINUTES")!.value) : s.breaks.reduce((a, b) => a + b.minutes, 0);

    const changes: { field: Field; original: string | null; value: string }[] = [];
    if (input.voidSession) changes.push({ field: "SESSION_VOID", original: cur.get("SESSION_VOID")?.value ?? "false", value: "true" });
    else {
      let inAt = currentIn;
      if (input.clockIn && input.clockIn !== berlinTime(currentIn)) {
        if (!/^\d{2}:\d{2}$/.test(input.clockIn)) return { error: "Beginn bitte als HH:MM." };
        inAt = berlinToInstant(day, input.clockIn);
        changes.push({ field: "CLOCK_IN", original: currentIn.toISOString(), value: inAt.toISOString() });
      }
      if (input.clockOut && (!currentOut || input.clockOut !== berlinTime(currentOut))) {
        if (!/^\d{2}:\d{2}$/.test(input.clockOut)) return { error: "Ende bitte als HH:MM." };
        const outDay = input.clockOut <= berlinTime(inAt) ? new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10) : day;
        const outAt = berlinToInstant(outDay, input.clockOut);
        if (outAt.getTime() - inAt.getTime() > 16 * 3600000) return { error: "Die Schicht wäre länger als 16 Stunden. Bitte Zeiten prüfen." };
        changes.push({ field: "CLOCK_OUT", original: currentOut?.toISOString() ?? null, value: outAt.toISOString() });
      }
      if (input.breakMinutes != null && input.breakMinutes !== currentBreak) {
        if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes > 240) return { error: "Pause bitte in Minuten (0–240)." };
        changes.push({ field: "BREAK_MINUTES", original: String(currentBreak), value: String(input.breakMinutes) });
      }
    }
    if (!changes.length) return { error: "Keine Änderung erkannt." };
    for (const c of changes) {
      await tx.timeCorrection.create({ data: { workSessionId: s.id, field: c.field, originalValue: c.original, correctedValue: c.value, reason, createdById: adminId, supersedesId: cur.get(c.field)?.id ?? null } });
    }
    const after = await recomputeSession(tx, s.id);
    if (after.status === "CLOSED") await tx.complianceFinding.updateMany({ where: { refId: s.id, code: "MISSING_CLOCK_OUT", status: "OPEN" }, data: { status: "REVIEWED", reviewedById: adminId, reviewedAt: new Date(), reviewNote: `Korrigiert: ${reason}` } });
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "SESSION_CORRECTED", entityType: "WorkSession", entityId: s.id, employeeId: s.employeeId, before: { payable: s.payableMinutes, status: s.status }, after: { payable: after.payableMinutes, changes }, reason });
    const closed = await tx.monthlyTimeClosing.findFirst({ where: { employeeId: s.employeeId, month: new Date(Date.UTC(s.workDate.getUTCFullYear(), s.workDate.getUTCMonth(), 1)), status: "CLOSED" } });
    const settled = await tx.payrollItem.findFirst({ where: { workSessionId: s.id, period: { status: "SETTLED" } } });
    return {
      ok: `Korrigiert. Vergütet jetzt ${Math.floor(after.payableMinutes / 60)}:${String(after.payableMinutes % 60).padStart(2, "0")} Std.`,
      warning: closed ? "Der Monat ist schon abgeschlossen – bitte im Monatsabschluss „Korrigieren“ wählen." : settled ? "Die Schicht war schon abgerechnet – die Differenz erscheint in der nächsten Aushilfenabrechnung." : undefined,
    };
  });
}

export const ADD_SESSION_PERMISSION = "timeclock.addSession";
export interface AddSessionInput { employeeId: string; date: string; clockIn: string; clockOut: string; breakMinutes: number; reason: string }

/**
 * Komplett vergessene Schicht nachtragen (nur mit Recht "timeclock.addSession" – Inhaber und Melanie).
 * Es wird KEINE Rohbuchung erfunden: Die Schicht hat keine Stempelung, ihre Zeiten stehen ausschließlich
 * in Korrektur-Datensätzen (ADD_SESSION + Beginn/Ende/Pause) mit Grund, Name und Zeitpunkt.
 */
export async function addManualSession(adminId: string, input: AddSessionInput): Promise<{ ok?: string; error?: string; warning?: string; sessionId?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) return { error: "Bitte einen Grund angeben (mind. 5 Zeichen)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Bitte ein Datum wählen." };
  if (!/^\d{2}:\d{2}$/.test(input.clockIn) || !/^\d{2}:\d{2}$/.test(input.clockOut)) return { error: "Beginn und Ende bitte als HH:MM." };
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes > 240) return { error: "Pause bitte in Minuten (0–240)." };
  const inAt = berlinToInstant(input.date, input.clockIn);
  const outDay = input.clockOut <= input.clockIn ? new Date(Date.parse(input.date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10) : input.date;
  const outAt = berlinToInstant(outDay, input.clockOut);
  if (outAt.getTime() - inAt.getTime() > 16 * 3600000) return { error: "Die Schicht wäre länger als 16 Stunden. Bitte Zeiten prüfen." };
  if (outAt > new Date()) return { error: "Das Ende liegt in der Zukunft." };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.employeeId}))`;
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!emp) return { error: "Mitarbeiter nicht gefunden." };
    // Keine Überschneidung mit vorhandenen Schichten
    const near = await tx.workSession.findMany({
      where: { employeeId: emp.id, workDate: { gte: dbDate(berlinDate(new Date(inAt.getTime() - 86400000))), lte: dbDate(outDay) } },
      include: { clockInEvent: true, clockOutEvent: true, corrections: { orderBy: { createdAt: "asc" } } },
    });
    for (const n of near) {
      const last = new Map<string, string>();
      for (const c of n.corrections) last.set(c.field, c.correctedValue);
      if (last.get("SESSION_VOID") === "true") continue;
      const a = last.has("CLOCK_IN") ? new Date(last.get("CLOCK_IN")!) : n.clockInEvent?.effectiveAt;
      const b = last.has("CLOCK_OUT") ? new Date(last.get("CLOCK_OUT")!) : n.clockOutEvent?.effectiveAt ?? new Date();
      if (a && a < outAt && b > inAt) return { error: `Überschneidet sich mit einer vorhandenen Schicht (${berlinTime(a)}–${berlinTime(b)} Uhr). Bitte dort korrigieren.` };
    }
    const shift = await findShift(tx, emp.id, inAt);
    const ws = await tx.workSession.create({
      data: {
        employeeId: emp.id, departmentId: shift?.departmentId ?? emp.primaryDeptId, workDate: shift?.workDate ?? dbDate(input.date), scheduledShiftId: shift?.id ?? null,
        clockInEventId: null, plannedStartAt: shift?.startAt ?? null, plannedEndAt: shift?.endAt ?? null, status: "CLOSED", computedAt: new Date(),
      },
    });
    const rows: { field: Field; value: string }[] = [
      { field: "ADD_SESSION", value: "true" }, { field: "CLOCK_IN", value: inAt.toISOString() },
      { field: "CLOCK_OUT", value: outAt.toISOString() }, { field: "BREAK_MINUTES", value: String(input.breakMinutes) },
    ];
    for (const r of rows) await tx.timeCorrection.create({ data: { workSessionId: ws.id, field: r.field, originalValue: null, correctedValue: r.value, reason, createdById: adminId } });
    const after = await recomputeSession(tx, ws.id);
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "SESSION_ADDED", entityType: "WorkSession", entityId: ws.id, employeeId: emp.id,
      after: { date: input.date, clockIn: input.clockIn, clockOut: input.clockOut, breakMinutes: input.breakMinutes, payable: after.payableMinutes }, reason });
    const closed = await tx.monthlyTimeClosing.findFirst({ where: { employeeId: emp.id, month: new Date(Date.UTC(ws.workDate.getUTCFullYear(), ws.workDate.getUTCMonth(), 1)), status: "CLOSED" } });
    return {
      sessionId: ws.id,
      ok: `Schicht nachgetragen: ${input.clockIn}–${input.clockOut}, vergütet ${Math.floor(after.payableMinutes / 60)}:${String(after.payableMinutes % 60).padStart(2, "0")} Std.`,
      warning: closed ? "Der Monat ist schon abgeschlossen – bitte im Monatsabschluss „Korrigieren“ wählen." : undefined,
    };
  });
}

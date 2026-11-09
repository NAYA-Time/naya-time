// Lädt alle Daten für die Monatsrechnung eines Mitarbeiters und rechnet (lesend, ohne zu speichern).
import type { Prisma, PrismaClient } from "@prisma/client";

import { computeMonth, monthBounds, type Decision, type MonthResult } from "./calc/month";
import { berlinDate, dbDate, minutesBetween } from "./time";

type Db = PrismaClient | Prisma.TransactionClient;
const ymd = (d: Date) => d.toISOString().slice(0, 10); // @db.Date-Werte sind UTC-Mitternacht

export async function accountBalanceBefore(db: Db, employeeId: string, month: string): Promise<number> {
  const { first, last } = monthBounds(month);
  const r = await db.workingTimeTransaction.aggregate({
    _sum: { minutes: true },
    where: { account: { employeeId }, bookingDate: { lte: dbDate(last) }, OR: [{ closingId: null }, { closing: { month: { lt: dbDate(first) } } }] },
  });
  return r._sum.minutes ?? 0;
}

export async function loadMonth(db: Db, employeeId: string, month: string, decision?: Decision, today = berlinDate(new Date())): Promise<MonthResult> {
  const { first, last } = monthBounds(month);
  const range = { gte: dbDate(first), lte: dbDate(last) };
  const [emp, sessions, absenceDays, shifts, balanceBefore, holidaySetting] = await Promise.all([
    db.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { contracts: true, overtimeRules: true } }),
    db.workSession.findMany({ where: { employeeId, workDate: range }, select: { workDate: true, status: true, payableMinutes: true } }),
    db.absenceDay.findMany({ where: { date: range, absence: { employeeId, status: { not: "CANCELLED" } } }, select: { date: true, creditedMinutes: true, absence: { select: { type: true } } } }),
    db.scheduledShift.findMany({ where: { employeeId, deletedAt: null, kind: "WORK", workDate: range, startAt: { not: null }, endAt: { not: null } }, select: { workDate: true, startAt: true, endAt: true, plannedBreakMinutes: true } }),
    accountBalanceBefore(db, employeeId, month),
    db.systemSetting.findUnique({ where: { key: "closing.holidayRule" } }),
  ]);
  const hr = holidaySetting?.value;
  return computeMonth({
    month, today, entryDate: ymd(emp.entryDate), exitDate: emp.exitDate ? ymd(emp.exitDate) : null,
    contracts: emp.contracts.map((c) => ({ ...c, validFrom: ymd(c.validFrom), validTo: c.validTo ? ymd(c.validTo) : null })),
    overtimeRules: emp.overtimeRules.map((r) => ({ validFrom: ymd(r.validFrom), validTo: r.validTo ? ymd(r.validTo) : null, includedMinutesPerMonth: r.includedMinutesPerMonth })),
    sessions: sessions.map((s) => ({ workDate: ymd(s.workDate), status: s.status, payableMinutes: s.payableMinutes })),
    absenceDays: absenceDays.map((a) => ({ date: ymd(a.date), type: a.absence.type, creditedMinutes: a.creditedMinutes })),
    plannedShifts: shifts.map((s) => ({ workDate: ymd(s.workDate), netMinutes: Math.max(0, minutesBetween(s.startAt!, s.endAt!) - s.plannedBreakMinutes) })),
    balanceBefore, decision,
    holidayRule: hr === "WORKDAY_TARGET" || hr === "PLANNED_SHIFT" ? hr : "NONE",
  });
}


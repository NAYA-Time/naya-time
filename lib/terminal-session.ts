import { prisma } from "./db";
import { signTicket } from "./crypto";
import { employeeState, findShift, markStaleSessions } from "./stamp";
import { requiredBreakForPresence } from "./calc/session";
import { runningBalance } from "./month-data";
import { vacationInclude, vacationOverview } from "./vacation";
import { reminderStatus, terminalNotice } from "./calc/reminders";
import { changeText } from "./shift-changes";
import { berlinDate, berlinLongDate, berlinTime, dbDate, minutesBetween } from "./time";

export const TICKET_TTL = 120; // Sekunden – danach muss der PIN erneut eingegeben werden

/** Was das Terminal nach erfolgreicher Anmeldung anzeigen darf (nur heutiger Dienst, kein Stundenkonto). */
export async function terminalGreeting(employeeId: string, terminalId: string) {
  const now = new Date();
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  await prisma.$transaction((tx) => markStaleSessions(tx, employeeId, now)); // vergessenes Ausstempeln → wieder "Kommen" anbieten
  const { state, session } = await employeeState(prisma, employeeId);
  const shift = session?.scheduledShiftId
    ? await prisma.scheduledShift.findUnique({ where: { id: session.scheduledShiftId } })
    : await findShift(prisma, employeeId, now);
  let askBreak = false;
  if (session) {
    const presence = minutesBetween(session.clockInEvent!.effectiveAt, now);
    const clocked = session.breaks.reduce((a, b) => a + (b.endAt ? b.minutes : minutesBetween(b.startAt!, now)), 0);
    askBreak = requiredBreakForPresence(presence) > clocked;
  }
  const actions = state === "OUT" ? ["CLOCK_IN"] : state === "IN" ? ["CLOCK_OUT", "BREAK_START"] : ["BREAK_END", "CLOCK_OUT"];
  return {
    ticket: signTicket({ e: employeeId, t: terminalId }, TICKET_TTL),
    firstName: emp.firstName,
    today: berlinLongDate(now),
    serverTime: now.toISOString(),
    state,
    since: session ? berlinTime(session.clockInEvent!.effectiveAt) : null,
    shift: shift?.startAt ? { start: berlinTime(shift.startAt), end: shift.endAt ? berlinTime(shift.endAt) : null } : null,
    actions,
    askBreak,
    plan: await myPlan(employeeId, now),
    vacation: await myVacation(employeeId, now),
    notices: await myNotices(employeeId, now),
    planChanges: await unseenPlanChanges(employeeId, now),
    // Gunnar 09.11.2026: beim Einstempeln täglich zeigen, wenn das Stundenkonto im Minus ist (Stand bis einschließlich gestern) – nur Minus, sonst nichts
    minusMinutes: state === "OUT" ? await minusUntilYesterday(employeeId, now) : null,
  };
}

/** Eigenes Urlaubskonto für "Mein Dienstplan" (nur wenn ein Anspruch hinterlegt ist) */
async function myVacation(employeeId: string, now: Date) {
  const year = Number(berlinDate(now).slice(0, 4));
  const [v] = await vacationOverview([await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: vacationInclude(year) })], year);
  return v.entitlement || v.taken || v.planned || v.carry ? { year, entitlement: v.entitlement + v.carry, taken: v.taken, planned: v.planned, rest: v.rest, carryOpen: v.carryOpen, carryExpires: v.carryExpires } : null;
}

/** Neue Dienstplanänderungen als Hinweis beim Anmelden – danach als gesehen markiert (die Markierung am Tag bleibt bis zum Tag). */
export async function unseenPlanChanges(employeeId: string, now: Date, markSeen = true): Promise<string[]> {
  const today = berlinDate(now);
  const cs = await prisma.shiftChange.findMany({ where: { employeeId, seenAt: null, workDate: { gte: dbDate(today) } }, orderBy: { workDate: "asc" } });
  if (markSeen && cs.length) await prisma.shiftChange.updateMany({ where: { id: { in: cs.map((c) => c.id) } }, data: { seenAt: now } });
  const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return cs.map((c) => {
    const d = berlinDate(c.workDate);
    return `${wd[new Date(d + "T12:00:00Z").getUTCDay()]} ${d.slice(8)}.${d.slice(5, 7)}.: ${c.after ? c.after + " – " : ""}${changeText(c)}`;
  });
}

/** Hinweise, die der Inhaber für diesen Mitarbeiter am Terminal freigegeben hat (Häkchen „Beim Einstempeln zeigen“) */
async function myNotices(employeeId: string, now: Date): Promise<string[]> {
  const today = berlinDate(now);
  const rs = await prisma.employeeReminder.findMany({ where: { employeeId, showOnTerminal: true, doneAt: null }, orderBy: { dueDate: "asc" } });
  return rs
    .map((r) => ({ ...r, due: r.dueDate.toISOString().slice(0, 10) }))
    .filter((r) => ["OVERDUE", "DUE_SOON"].includes(reminderStatus({ dueDate: r.due, remindDaysBefore: r.remindDaysBefore, done: false }, today)))
    .map((r) => terminalNotice({ kind: r.kind, title: r.title, dueDate: r.due, terminalText: r.terminalText }));
}

async function minusUntilYesterday(employeeId: string, now: Date): Promise<number | null> {
  try {
    const b = await runningBalance(prisma, employeeId, berlinDate(now));
    return b !== null && b < 0 ? -b : null;
  } catch (e) {
    console.error("Stundenkonto-Stand", e); // Einstempeln darf daran nie scheitern
    return null;
  }
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ABS: Record<string, string> = { VACATION: "Urlaub", SICK: "Krank", SICK_CHILD: "Kind krank", SPECIAL_LEAVE: "Sonderurlaub", UNPAID: "Unbezahlt frei", TIME_OFF_IN_LIEU: "Freizeitausgleich" };
export type PlanWeek = { title: string; range: string; published: boolean; days: { label: string; today: boolean; shifts: string[]; absence: string | null; change: string | null }[] };

/** "Mein Dienstplan": nur die eigenen Dienste und Abwesenheiten, diese und nächste Woche. Keine Kollegen, kein Stundenkonto. */
export async function myPlan(employeeId: string, now: Date): Promise<PlanWeek[]> {
  const today = berlinDate(now);
  const monday = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
  const end = addDays(monday, 13);
  const [shifts, absences, scheds, changes] = await Promise.all([
    prisma.scheduledShift.findMany({ where: { employeeId, deletedAt: null, kind: "WORK", workDate: { gte: dbDate(monday), lte: dbDate(end) } }, orderBy: { startAt: "asc" } }),
    prisma.absence.findMany({ where: { employeeId, status: { not: "CANCELLED" }, startDate: { lte: dbDate(end) }, endDate: { gte: dbDate(monday) } } }),
    prisma.workSchedule.findMany({ where: { departmentId: null, periodStart: { in: [dbDate(monday), dbDate(addDays(monday, 7))] } } }),
    prisma.shiftChange.findMany({ where: { employeeId, workDate: { gte: dbDate(today), lte: dbDate(end) } }, orderBy: { changedAt: "asc" } }),
  ]);
  const changeBy = new Map(changes.map((c) => [berlinDate(c.workDate), changeText(c)])); // letzte Änderung je Tag
  const de = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}.`;
  return [0, 7].map((off, w) => {
    const m = addDays(monday, off);
    return {
      title: w === 0 ? "Diese Woche" : "Nächste Woche",
      range: `${de(m)} – ${de(addDays(m, 6))}`,
      published: scheds.some((x) => berlinDate(x.periodStart) === m && x.status === "PUBLISHED"),
      days: WD.map((wd, i) => {
        const d = addDays(m, i);
        const abs = absences.find((a) => berlinDate(a.startDate) <= d && berlinDate(a.endDate) >= d);
        return {
          label: `${wd} ${de(d)}`,
          today: d === today,
          shifts: shifts.filter((s) => berlinDate(s.workDate) === d && s.startAt).map((s) => `${berlinTime(s.startAt!)}–${s.endAt ? berlinTime(s.endAt) : "?"}`),
          absence: abs ? ABS[abs.type] ?? "Abwesend" : null,
          change: changeBy.get(d) ?? null,
        };
      }),
    };
  });
}

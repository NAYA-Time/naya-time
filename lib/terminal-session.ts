import { prisma } from "./db";
import { signTicket } from "./crypto";
import { employeeState, findShift, markStaleSessions } from "./stamp";
import { requiredBreakForPresence } from "./calc/session";
import { berlinLongDate, berlinTime, minutesBetween } from "./time";

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
  };
}

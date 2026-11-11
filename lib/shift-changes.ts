// Dienstplanänderungen je Mitarbeiter festhalten, damit er sie am Terminal und am Handy farbig sieht.
import type { Prisma } from "@prisma/client";
import { berlinTime, dbDate } from "./time";

type Tx = Prisma.TransactionClient;
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const mondayOf = (ymd: string) => addDays(ymd, -((new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7));

/** Dienste eines Tages als Text, z. B. "15:00–23:30" (null = frei) */
export async function dayLabel(tx: Tx, employeeId: string, date: string): Promise<string | null> {
  const s = await tx.scheduledShift.findMany({ where: { employeeId, deletedAt: null, kind: "WORK", workDate: dbDate(date), startAt: { not: null } }, orderBy: { startAt: "asc" } });
  return s.length ? s.map((x) => `${berlinTime(x.startAt!)}–${x.endAt ? berlinTime(x.endAt) : "?"}`).join(", ") : null;
}

/** Hatte der Mitarbeiter in dieser Woche schon einen Plan? (Erster Plan einer Woche gilt nicht als Änderung.) */
export async function hadPlanInWeek(tx: Tx, employeeId: string, date: string): Promise<boolean> {
  const m = mondayOf(date);
  return (await tx.scheduledShift.count({ where: { employeeId, kind: "WORK", workDate: { gte: dbDate(m), lte: dbDate(addDays(m, 6)) }, createdAt: { lt: new Date(Date.now() - 1000) } } })) > 0;
}

/** Vorher/Nachher eines Tages vergleichen und als Änderung speichern (ungesehene Änderungen am selben Tag werden zusammengefasst). */
export async function recordDayChange(tx: Tx, employeeId: string, date: string, before: string | null, hadPlan: boolean) {
  const after = await dayLabel(tx, employeeId, date);
  const open = await tx.shiftChange.findFirst({ where: { employeeId, workDate: dbDate(date), seenAt: null }, orderBy: { changedAt: "desc" } });
  if (open) {
    if (open.before === after) await tx.shiftChange.delete({ where: { id: open.id } }); // zurückgeändert
    else await tx.shiftChange.update({ where: { id: open.id }, data: { after, changedAt: new Date() } });
    return;
  }
  if (before === after || (!before && !hadPlan)) return;
  await tx.shiftChange.create({ data: { employeeId, workDate: dbDate(date), before, after } });
}

/** Text für den Tag, z. B. "geändert (vorher 15:00–23:30)" */
export function changeText(c: { before: string | null; after: string | null }): string {
  if (!c.after) return `gestrichen (war ${c.before})`;
  if (!c.before) return "neu";
  return `geändert, vorher ${c.before}`;
}

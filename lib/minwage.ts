// Mindestlohn-Prüfung für alle aktiven Mitarbeiter mit Stundenlohn (nur Hinweis, nichts wird blockiert)
import { prisma } from "./db";
import { berlinDate } from "./time";
import { wageIssues, type WageIssue } from "./calc/minwage";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const toRows = (ws: { validFrom: Date; validTo: Date | null; centsPerHour: number }[]) => ws.map((w) => ({ validFrom: ymd(w.validFrom), validTo: w.validTo ? ymd(w.validTo) : null, centsPerHour: w.centsPerHour }));

export async function minimumWageProblems(today = berlinDate(new Date())): Promise<{ id: string; name: string; issues: WageIssue[] }[]> {
  const emps = await prisma.employee.findMany({ where: { active: true, wages: { some: {} } }, include: { wages: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return emps.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, issues: wageIssues(toRows(e.wages), today) })).filter((x) => x.issues.length);
}

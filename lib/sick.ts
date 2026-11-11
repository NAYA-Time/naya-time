// Krankheitstage je Mitarbeiter: laufendes Jahr und seit Beginn der Beschäftigung (Kalendertage bis heute, ohne Diagnosen).
import { prisma } from "./db";
import { berlinDate } from "./time";

export type SickCounts = { year: number; sickYear: number; sickTotal: number; childYear: number; childTotal: number };

export async function sickCounts(employeeIds: string[], today = berlinDate(new Date())): Promise<Map<string, SickCounts>> {
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const abs = await prisma.absence.findMany({ where: { employeeId: { in: employeeIds }, type: { in: ["SICK", "SICK_CHILD"] }, status: { not: "CANCELLED" }, startDate: { lte: new Date(today + "T00:00:00Z") } } });
  const span = (a: string, b: string) => (a > b ? 0 : Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1);
  const out = new Map<string, SickCounts>(employeeIds.map((id) => [id, { year, sickYear: 0, sickTotal: 0, childYear: 0, childTotal: 0 }]));
  for (const a of abs) {
    const s = a.startDate.toISOString().slice(0, 10), e0 = a.endDate.toISOString().slice(0, 10);
    const e = e0 < today ? e0 : today;
    const total = span(s, e), inYear = span(s > yearStart ? s : yearStart, e);
    const c = out.get(a.employeeId)!;
    if (a.type === "SICK") { c.sickTotal += total; c.sickYear += inYear; } else { c.childTotal += total; c.childYear += inYear; }
  }
  return out;
}

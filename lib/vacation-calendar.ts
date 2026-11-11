// Daten für die Urlaubsübersicht laden (Urlaub eingetragen/genehmigt + offene Anträge vom Handy).
import { prisma } from "./db";
import { mainKey } from "./dept";
import { berlinDate, dbDate } from "./time";
import type { CalEmployee, CalEntry, DeptKey } from "./calc/vacation-calendar";

export async function loadVacationData(from: string, to: string): Promise<{ emps: CalEmployee[]; entries: CalEntry[] }> {
  const overlap = { startDate: { lte: dbDate(to) }, endDate: { gte: dbDate(from) } };
  const [absences, requests] = await Promise.all([
    prisma.absence.findMany({ where: { type: "VACATION", status: { not: "CANCELLED" }, ...overlap }, include: { days: { select: { date: true, vacationDayValue: true } } } }),
    prisma.vacationRequest.findMany({ where: { status: "OPEN", ...overlap } }),
  ]);
  const ids = new Set([...absences.map((a) => a.employeeId), ...requests.map((r) => r.employeeId)]);
  const emps = await prisma.employee.findMany({
    where: { OR: [{ active: true }, { id: { in: [...ids] } }] },
    include: { primaryDept: { include: { parent: true } } },
  });
  const deptOf = (k: string | null): DeptKey => (k === "KUECHE" || k === "SERVICE" || k === "SPUELE" || k === "BUERO" ? k : "OTHER");
  return {
    emps: emps.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, dept: deptOf(mainKey(e.primaryDept)) })),
    entries: [
      ...absences.map((a) => ({ employeeId: a.employeeId, from: berlinDate(a.startDate), to: berlinDate(a.endDate), kind: "U" as const, days: a.days.map((d) => ({ date: berlinDate(d.date), value: d.vacationDayValue })) })),
      ...requests.map((r) => ({ employeeId: r.employeeId, from: berlinDate(r.startDate), to: berlinDate(r.endDate), kind: "A" as const })),
    ],
  };
}

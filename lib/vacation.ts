// Urlaubskonto je Mitarbeiter für ein Jahr: Anspruch (bei Eintritt anteilig), Übertrag, genommen, geplant, Rest.
import { prisma } from "./db";
import { berlinDate } from "./time";

function dbYearStart(y: number) { return new Date(`${y}-01-01T00:00:00.000Z`); }

export type VacationEmp = { id: string; firstName: string; lastName: string; entryDate: Date; contracts: { vacationDaysPerYear: number }[]; vacationBalances: { carryOverHalfDays: number; manualAdjustHalfDays: number }[] };
export const vacationInclude = (year: number) => ({ contracts: { orderBy: { validFrom: "desc" as const }, take: 1 }, vacationBalances: { where: { year } } });

export async function vacationOverview(emps: { id: string; firstName: string; lastName: string; entryDate: Date; contracts: { vacationDaysPerYear: number }[]; vacationBalances: { carryOverHalfDays: number; manualAdjustHalfDays: number }[] }[], year: number) {
  const days = await prisma.absenceDay.findMany({
    where: { vacationDayValue: { gt: 0 }, date: { gte: dbYearStart(year), lt: dbYearStart(year + 1) }, absence: { status: { not: "CANCELLED" }, employeeId: { in: emps.map((e) => e.id) } } },
    include: { absence: { select: { employeeId: true } } },
  });
  const today = new Date(berlinDate(new Date()) + "T00:00:00Z");
  return emps.map((e) => {
    const full = e.contracts[0]?.vacationDaysPerYear ?? 0;
    const entryYear = e.entryDate.getUTCFullYear();
    const months = entryYear < year ? 12 : entryYear > year ? 0 : 12 - e.entryDate.getUTCMonth() - (e.entryDate.getUTCDate() > 1 ? 1 : 0);
    const entitlement = Math.ceil(((full * months) / 12) * 2) / 2;
    const bal = e.vacationBalances[0];
    const carry = (bal?.carryOverHalfDays ?? 0) / 2 + (bal?.manualAdjustHalfDays ?? 0) / 2;
    const mine = days.filter((d) => d.absence.employeeId === e.id);
    const taken = mine.filter((d) => d.date <= today).reduce((x, d) => x + d.vacationDayValue, 0) / 2;
    const planned = mine.filter((d) => d.date > today).reduce((x, d) => x + d.vacationDayValue, 0) / 2;
    return { id: e.id, name: `${e.lastName}, ${e.firstName}`, entitlement, carry, taken, planned, rest: entitlement + carry - taken - planned };
  });
}

/** Genommene Urlaubstage seit Beginn der Beschäftigung (bis heute) */
export async function vacationTakenTotal(employeeId: string): Promise<number> {
  const today = new Date(berlinDate(new Date()) + "T00:00:00Z");
  const r = await prisma.absenceDay.aggregate({ _sum: { vacationDayValue: true }, where: { date: { lte: today }, vacationDayValue: { gt: 0 }, absence: { employeeId, status: { not: "CANCELLED" } } } });
  return (r._sum.vacationDayValue ?? 0) / 2;
}

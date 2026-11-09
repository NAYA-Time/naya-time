// Urlaubskonto je Mitarbeiter für ein Jahr: Anspruch (bei Eintritt anteilig), Übertrag, genommen, geplant, Rest.
import { prisma } from "./db";
import { berlinDate } from "./time";
import { entitlementFor, vacationYear } from "./calc/vacation";

function dbYearStart(y: number) { return new Date(`${y}-01-01T00:00:00.000Z`); }

export type VacationEmp = { id: string; firstName: string; lastName: string; entryDate: Date; contracts: { vacationDaysPerYear: number }[] };
export const vacationInclude = (_year?: number) => ({ contracts: { orderBy: { validFrom: "desc" as const }, take: 1 } });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Urlaubskonto je Mitarbeiter für ein Jahr – mit automatischem Übertrag aus den Vorjahren (siehe lib/calc/vacation.ts) */
export async function vacationOverview(emps: VacationEmp[], year: number, todayStr = berlinDate(new Date())) {
  const ids = emps.map((e) => e.id);
  const [days, balances] = await Promise.all([
    prisma.absenceDay.findMany({
      where: { vacationDayValue: { gt: 0 }, date: { gte: dbYearStart(year - 5), lt: dbYearStart(year + 1) }, absence: { status: { not: "CANCELLED" }, employeeId: { in: ids } } },
      select: { date: true, vacationDayValue: true, absence: { select: { employeeId: true } } },
    }),
    prisma.vacationBalance.findMany({ where: { employeeId: { in: ids }, year: { gte: year - 6, lte: year } } }),
  ]);
  return emps.map((e) => {
    const bal = balances.filter((b) => b.employeeId === e.id);
    const r = vacationYear({
      entryDate: ymd(e.entryDate), daysPerYear: e.contracts[0]?.vacationDaysPerYear ?? 0, today: todayStr, year,
      days: days.filter((d) => d.absence.employeeId === e.id).map((d) => ({ date: ymd(d.date), value: d.vacationDayValue / 2 })),
      adjust: new Map(bal.map((b) => [b.year, b.manualAdjustHalfDays / 2])),
      reminder: new Map(bal.map((b) => [b.year, b.reminderSentAt ? b.reminderSentAt.toISOString() : null])),
    });
    const reminded = bal.find((b) => b.year === year)?.reminderSentAt ?? null;
    return { id: e.id, name: `${e.lastName}, ${e.firstName}`, ...r, reminderThisYear: reminded };
  });
}

/** Hinweis „Resturlaub nehmen, sonst Verfall“ für ein Jahr dokumentieren */
export async function recordVacationReminder(employeeId: string, year: number, adminId: string) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: vacationInclude() });
  const ent = entitlementFor(ymd(e.entryDate), e.contracts[0]?.vacationDaysPerYear ?? 0, year);
  return prisma.vacationBalance.upsert({
    where: { employeeId_year: { employeeId, year } },
    update: { reminderSentAt: new Date(), reminderById: adminId },
    create: { employeeId, year, entitlementHalfDays: Math.round(ent * 2), reminderSentAt: new Date(), reminderById: adminId },
  });
}

/** Genommene Urlaubstage seit Beginn der Beschäftigung (bis heute) */
export async function vacationTakenTotal(employeeId: string): Promise<number> {
  const today = new Date(berlinDate(new Date()) + "T00:00:00Z");
  const r = await prisma.absenceDay.aggregate({ _sum: { vacationDayValue: true }, where: { date: { lte: today }, vacationDayValue: { gt: 0 }, absence: { employeeId, status: { not: "CANCELLED" } } } });
  return (r._sum.vacationDayValue ?? 0) / 2;
}

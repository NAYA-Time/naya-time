// Abwesenheit anlegen (ohne Next.js): genutzt vom Formular im Backend und von der Genehmigung eines Urlaubsantrags.
import type { AbsenceType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { absenceDay, datesBetween } from "./calc/absence";
import { berlinDate, dbDate } from "./time";

export const KINDS: AbsenceType[] = ["VACATION", "SICK", "SICK_CHILD", "SPECIAL_LEAVE", "UNPAID", "TIME_OFF_IN_LIEU"];

export async function closedIn(employeeId: string, from: string, to: string) {
  const c = await prisma.monthlyTimeClosing.findFirst({ where: { employeeId, status: "CLOSED", month: { gte: dbDate(from.slice(0, 7) + "-01"), lte: dbDate(to.slice(0, 7) + "-01") } } });
  return !!c;
}

export async function createAbsenceCore(adminId: string, input: { employeeId: string; type: AbsenceType; from: string; to?: string; note?: string; certificate?: string; source?: string }): Promise<{ ok?: string; error?: string; absenceId?: string }> {
  const { employeeId, type, from } = input;
  const to = input.to || from;
  if (!employeeId || !KINDS.includes(type)) return { error: "Bitte Mitarbeiter und Art wählen." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || to < from) return { error: "Bitte gültige Daten angeben (bis ≥ von)." };
  const days = datesBetween(from, to);
  if (days.length > 366) return { error: "Zeitraum zu lang." };
  const overlap = await prisma.absence.findFirst({ where: { employeeId, status: { not: "CANCELLED" }, startDate: { lte: dbDate(to) }, endDate: { gte: dbDate(from) } } });
  if (overlap) return { error: "In diesem Zeitraum ist bereits eine Abwesenheit eingetragen." };
  if (await closedIn(employeeId, from, to)) return { error: "Der Zeitraum liegt in einem abgeschlossenen Monat. Bitte den Monatsabschluss danach korrigieren oder zuerst die Abwesenheit im offenen Monat eintragen." };

  const [contracts, shifts] = await Promise.all([
    prisma.employeeContract.findMany({ where: { employeeId }, orderBy: { validFrom: "desc" } }),
    prisma.scheduledShift.findMany({ where: { employeeId, deletedAt: null, kind: "WORK", workDate: { gte: dbDate(from), lte: dbDate(to) }, startAt: { not: null }, endAt: { not: null } } }),
  ]);
  if (!contracts.length) return { error: "Für diesen Mitarbeiter ist kein Vertrag hinterlegt." };
  const contractAt = (d: string) => contracts.find((c) => c.validFrom <= dbDate(d) && (!c.validTo || c.validTo >= dbDate(d))) ?? contracts[0];
  const rows = days.map((d) => {
    const sh = shifts.filter((s) => berlinDate(s.workDate) === d).map((s) => ({ startAt: s.startAt!, endAt: s.endAt!, plannedBreakMinutes: s.plannedBreakMinutes }));
    return absenceDay(type, d, contractAt(d), sh);
  });
  const status = dbDate(from) > dbDate(berlinDate(new Date())) && type === "VACATION" ? "PLANNED" : "CONFIRMED";
  const note = (input.note ?? "").trim().slice(0, 300) || null;

  const absenceId = await prisma.$transaction(async (tx) => {
    const a = await tx.absence.create({
      data: {
        employeeId, type, startDate: dbDate(from), endDate: dbDate(to), status, note, createdById: adminId,
        days: { create: rows.map((r) => ({ date: dbDate(r.date), creditedMinutes: r.creditedMinutes, vacationDayValue: r.vacationDayValue, basis: r.basis, shiftSnapshot: (r.shiftSnapshot ?? undefined) as Prisma.InputJsonValue | undefined })) },
        ...(type === "SICK" || type === "SICK_CHILD" ? { sickLeave: { create: { certificateStatus: input.certificate ?? "UNKNOWN" } } } : {}),
      },
    });
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "ABSENCE_CREATED", entityType: "Absence", entityId: a.id, employeeId, after: { type, from, to, days: rows.length, credited: rows.reduce((x, r) => x + r.creditedMinutes, 0), source: input.source } });
    return a.id;
  });
  const credited = rows.reduce((x, r) => x + r.creditedMinutes, 0);
  const vac = rows.reduce((x, r) => x + r.vacationDayValue, 0) / 2;
  return { absenceId, ok: `Eingetragen: ${rows.length} ${rows.length === 1 ? "Kalendertag" : "Kalendertage"}, angerechnet ${Math.floor(credited / 60)}:${String(credited % 60).padStart(2, "0")} Std.${type === "VACATION" ? ` (${vac} ${vac === 1 ? "Urlaubstag" : "Urlaubstage"})` : ""}` };
}


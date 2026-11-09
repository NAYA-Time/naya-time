"use server";
import { revalidatePath } from "next/cache";
import type { AbsenceType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { absenceDay, datesBetween } from "./calc/absence";
import { berlinDate, dbDate } from "./time";
import type { FormState } from "./admin-actions-auth";

const KINDS: AbsenceType[] = ["VACATION", "SICK", "SICK_CHILD", "SPECIAL_LEAVE", "UNPAID", "TIME_OFF_IN_LIEU"];

async function closedIn(employeeId: string, from: string, to: string) {
  const c = await prisma.monthlyTimeClosing.findFirst({ where: { employeeId, status: "CLOSED", month: { gte: dbDate(from.slice(0, 7) + "-01"), lte: dbDate(to.slice(0, 7) + "-01") } } });
  return !!c;
}

export async function createAbsence(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("absences.manage");
  const employeeId = String(fd.get("employeeId") ?? "");
  const type = String(fd.get("type")) as AbsenceType;
  const from = String(fd.get("from") ?? ""), to = String(fd.get("to") ?? "") || from;
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
  const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;

  await prisma.$transaction(async (tx) => {
    const a = await tx.absence.create({
      data: {
        employeeId, type, startDate: dbDate(from), endDate: dbDate(to), status, note, createdById: admin.id,
        days: { create: rows.map((r) => ({ date: dbDate(r.date), creditedMinutes: r.creditedMinutes, vacationDayValue: r.vacationDayValue, basis: r.basis, shiftSnapshot: (r.shiftSnapshot ?? undefined) as Prisma.InputJsonValue | undefined })) },
        ...(type === "SICK" || type === "SICK_CHILD" ? { sickLeave: { create: { certificateStatus: String(fd.get("certificate") ?? "UNKNOWN") } } } : {}),
      },
    });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "ABSENCE_CREATED", entityType: "Absence", entityId: a.id, employeeId, after: { type, from, to, days: rows.length, credited: rows.reduce((x, r) => x + r.creditedMinutes, 0) } });
  });
  revalidatePath("/admin/krankheit");
  revalidatePath("/admin/urlaub");
  const credited = rows.reduce((x, r) => x + r.creditedMinutes, 0);
  const vac = rows.reduce((x, r) => x + r.vacationDayValue, 0) / 2;
  return { ok: `Eingetragen: ${rows.length} Kalendertage, angerechnet ${Math.floor(credited / 60)}:${String(credited % 60).padStart(2, "0")} Std.${type === "VACATION" ? `, ${vac} Urlaubstage` : ""}.` };
}

export async function cancelAbsence(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("absences.manage");
  const id = String(fd.get("id"));
  const cur = await prisma.absence.findUniqueOrThrow({ where: { id } });
  if (await closedIn(cur.employeeId, berlinDate(cur.startDate), berlinDate(cur.endDate))) return { error: "Diese Abwesenheit liegt in einem abgeschlossenen Monat und kann nicht mehr storniert werden." };
  await prisma.$transaction(async (tx) => {
    const a = await tx.absence.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "ABSENCE_CANCELLED", entityType: "Absence", entityId: id, employeeId: a.employeeId });
  });
  revalidatePath("/admin/krankheit");
  revalidatePath("/admin/urlaub");
  return { ok: "Storniert. Der Eintrag bleibt im Protokoll sichtbar." };
}

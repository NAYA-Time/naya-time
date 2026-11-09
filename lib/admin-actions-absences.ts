"use server";
import { revalidatePath } from "next/cache";
import type { AbsenceType } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { berlinDate } from "./time";
import { closedIn, createAbsenceCore } from "./absences";
import type { FormState } from "./admin-actions-auth";
import { recordVacationReminder } from "./vacation";


export async function createAbsence(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("absences.manage");
  const res = await createAbsenceCore(admin.id, {
    employeeId: String(fd.get("employeeId") ?? ""), type: String(fd.get("type")) as AbsenceType,
    from: String(fd.get("from") ?? ""), to: String(fd.get("to") ?? ""), note: String(fd.get("note") ?? ""), certificate: String(fd.get("certificate") ?? "UNKNOWN"),
  });
  revalidatePath("/admin/krankheit");
  revalidatePath("/admin/urlaub");
  return res;
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

/** Hinweis zum Resturlaub (Verfall) dokumentieren – Voraussetzung dafür, dass Übertrag nach 31.03. verfallen darf */
export async function markVacationReminder(fd: FormData): Promise<void> {
  const admin = await requireAdmin("absences.manage");
  const id = String(fd.get("id")), year = Number(fd.get("year"));
  if (!id || !Number.isInteger(year)) return;
  const b = await recordVacationReminder(id, year, admin.id);
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "VACATION_REMINDER_RECORDED", entityType: "VacationBalance", entityId: b.id, employeeId: id, after: { year } }));
  revalidatePath("/admin/urlaub");
}

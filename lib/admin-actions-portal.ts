"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { createInvite } from "./portal";
import { createAbsenceCore } from "./absences";
import { berlinDate } from "./time";
import type { FormState } from "./admin-actions-auth";

export type InviteState = { error?: string; link?: string; qr?: string } | undefined;

/** Einladungslink fürs Handy (7 Tage gültig, einmal verwendbar). Auch für "Passwort vergessen". */
export async function createPortalInviteAction(_: InviteState, fd: FormData): Promise<InviteState> {
  const admin = await requireAdmin("employees.manage");
  const id = String(fd.get("id") ?? "");
  const c = await prisma.employeeCredential.findUnique({ where: { employeeId: id } });
  if (!c?.portalEnabled) return { error: "Bitte zuerst „Handy-Zugang freischalten“ anhaken und speichern." };
  const token = await createInvite(id, admin.id);
  const h = await headers();
  const base = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const link = `${base}/portal/einladung/${token}`;
  revalidatePath(`/admin/mitarbeiter/${id}`);
  return { link, qr: await QRCode.toDataURL(link, { margin: 1, width: 240 }) };
}

/** Urlaubsantrag genehmigen (legt den Urlaub an) oder ablehnen */
export async function decideVacationRequest(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("absences.manage");
  const id = String(fd.get("id") ?? ""), approve = fd.get("decision") === "approve";
  const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;
  const r = await prisma.vacationRequest.findUnique({ where: { id }, include: { employee: true } });
  if (!r || r.status !== "OPEN") return { error: "Dieser Antrag ist nicht mehr offen." };
  let absenceId: string | null = null, msg = "";
  if (approve) {
    const res = await createAbsenceCore(admin.id, { employeeId: r.employeeId, type: "VACATION", from: berlinDate(r.startDate), to: berlinDate(r.endDate), note: r.note ?? undefined, source: "VACATION_REQUEST" });
    if (res.error) return { error: res.error };
    absenceId = res.absenceId ?? null; msg = res.ok ?? "";
  }
  await prisma.$transaction(async (tx) => {
    await tx.vacationRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: admin.id, decidedAt: new Date(), decisionNote: note, absenceId } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: approve ? "VACATION_REQUEST_APPROVED" : "VACATION_REQUEST_REJECTED", entityType: "VacationRequest", entityId: id, employeeId: r.employeeId, after: { note, absenceId } });
  });
  revalidatePath("/admin/urlaub");
  revalidatePath("/admin");
  return { ok: approve ? `Genehmigt – ${r.employee.firstName} sieht es am Handy. ${msg}` : `Abgelehnt – ${r.employee.firstName} sieht es am Handy.` };
}

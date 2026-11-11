"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./admin-auth";
import { prisma } from "./db";
import { eraseEmployee } from "./erasure";
import type { FormState } from "./admin-actions-auth";

/** Nur der Inhaber; zur Bestätigung muss die Personalnummer eingetippt werden. */
export async function eraseEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  if (admin.roleKey !== "OWNER") return { error: "Nur der Inhaber kann Mitarbeiterdaten löschen." };
  const id = String(fd.get("id") ?? "");
  const e = await prisma.employee.findUnique({ where: { id }, select: { personnelNumber: true } });
  if (!e) return { error: "Mitarbeiter nicht gefunden." };
  if (String(fd.get("confirm") ?? "").trim() !== e.personnelNumber) return { error: "Zur Bestätigung bitte genau die Personalnummer eintippen." };
  const res = await eraseEmployee(id, admin.id);
  if (res.ok) revalidatePath("/admin/loeschung");
  return res;
}

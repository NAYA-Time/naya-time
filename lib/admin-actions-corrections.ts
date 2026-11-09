"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./admin-auth";
import { ADD_SESSION_PERMISSION, addManualSession, correctSession } from "./corrections";
import type { FormState } from "./admin-actions-auth";

export async function correctSessionAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("timeclock.correct");
  const brk = String(fd.get("breakMinutes") ?? "").trim();
  const r = await correctSession(admin.id, String(fd.get("id")), {
    clockIn: String(fd.get("clockIn") ?? "") || undefined, clockOut: String(fd.get("clockOut") ?? "") || undefined,
    breakMinutes: brk === "" ? null : Number(brk), voidSession: fd.get("void") === "on", reason: String(fd.get("reason") ?? "").slice(0, 300),
  });
  revalidatePath("/admin/zeiten");
  revalidatePath("/admin/monatsabschluss");
  return r.error ? { error: r.error } : { ok: r.warning ? `${r.ok} ${r.warning}` : r.ok };
}

export async function addSessionAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin(ADD_SESSION_PERMISSION);
  const brk = String(fd.get("breakMinutes") ?? "").trim();
  const r = await addManualSession(admin.id, {
    employeeId: String(fd.get("employeeId") ?? ""), date: String(fd.get("date") ?? ""), clockIn: String(fd.get("clockIn") ?? ""), clockOut: String(fd.get("clockOut") ?? ""),
    breakMinutes: brk === "" ? 0 : Number(brk), reason: String(fd.get("reason") ?? "").slice(0, 300),
  });
  revalidatePath("/admin/zeiten");
  revalidatePath("/admin/monatsabschluss");
  return r.error ? { error: r.error } : { ok: r.warning ? `${r.ok} ${r.warning}` : r.ok };
}

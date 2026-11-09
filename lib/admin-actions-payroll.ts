"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "./admin-auth";
import { cancelPayrollPeriod, createPayrollPeriod, recordPayment, settlePayrollPeriod } from "./payroll";
import type { FormState } from "./admin-actions-auth";

const done = (r: { ok?: string; error?: string }): FormState => {
  revalidatePath("/admin/aushilfen", "layout");
  return r.error ? { error: r.error } : { ok: r.ok };
};

export async function preparePayrollAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("payroll.manage");
  const cutoff = String(fd.get("cutoff") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return { error: "Bitte einen Stichtag angeben." };
  const label = String(fd.get("label") ?? "").trim().slice(0, 80) || `Aushilfen bis ${cutoff.split("-").reverse().join(".")}`;
  const r = await createPayrollPeriod(admin.id, cutoff, label);
  if (r.id) redirect(`/admin/aushilfen/${r.id}`);
  return done(r);
}

export async function settlePayrollAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("payroll.manage");
  return done(await settlePayrollPeriod(admin.id, String(fd.get("id"))));
}

export async function cancelPayrollAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("payroll.manage");
  return done(await cancelPayrollPeriod(admin.id, String(fd.get("id"))));
}

export async function paymentAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("payroll.manage");
  const paidOn = String(fd.get("paidOn") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: "Bitte das Zahlungsdatum angeben." };
  const reverseId = String(fd.get("reverseId") ?? "") || undefined;
  const euros = String(fd.get("amount") ?? "").trim().replace(/\./g, "").replace(",", ".");
  const cents = reverseId ? 0 : Math.round(Number(euros) * 100);
  if (!reverseId && !(cents > 0)) return { error: "Betrag bitte wie 450,00 eingeben." };
  return done(await recordPayment(admin.id, String(fd.get("settlementId")), cents, paidOn, String(fd.get("reference") ?? "").trim().slice(0, 80) || null, reverseId));
}

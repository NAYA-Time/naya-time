"use server";
import { revalidatePath } from "next/cache";
import type { AccountTxType } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import type { Decision } from "./calc/month";
import { closeEmployeeMonth, correctEmployeeClosing, monthLabel } from "./closing";
import { dbDate, fmtMinutes } from "./time";
import { parseHours } from "./admin-actions-employees";
import type { FormState } from "./admin-actions-auth";

export async function closeMonth(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("closing.manage");
  const employeeId = String(fd.get("employeeId") ?? ""), month = String(fd.get("month") ?? "");
  const decision = String(fd.get("decision") ?? "") as Decision;
  if (!/^\d{4}-\d{2}$/.test(month) || !employeeId) return { error: "Ungültige Angaben." };
  const res = await closeEmployeeMonth(admin.id, employeeId, month, ["AUTO_BOOKED", "EMPLOYEE_CAUSED", "EMPLOYER_CAUSED"].includes(decision) ? decision : undefined);
  revalidatePath("/admin/monatsabschluss");
  revalidatePath("/admin/stundenkonten");
  if (!res.ok) return { error: res.error };
  return { ok: `Abgeschlossen. Konto ${res.r.accountChange >= 0 ? "+" : ""}${fmtMinutes(res.r.accountChange)}, neuer Stand ${fmtMinutes(res.r.balanceAfter)}.` };
}

/** Alle Festangestellten ohne Hindernisse abschließen (Defizite nach Standard: automatisch Minusstunden) */
export async function closeAll(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("closing.manage");
  const month = String(fd.get("month") ?? "");
  const ids = String(fd.get("ids") ?? "").split(",").filter(Boolean);
  if (!/^\d{4}-\d{2}$/.test(month) || !ids.length) return { error: "Keine Mitarbeiter zum Abschließen." };
  let done = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const res = await closeEmployeeMonth(admin.id, id, month);
    if (res.ok) done++;
    else failed.push(res.error);
  }
  revalidatePath("/admin/monatsabschluss");
  revalidatePath("/admin/stundenkonten");
  return failed.length ? { error: `${done} abgeschlossen, ${failed.length} nicht: ${failed.join(" · ")}` } : { ok: `${done} Mitarbeiter für ${monthLabel(month)} abgeschlossen.` };
}

/** Abgeschlossenen Monat korrigieren: neue Version, alte bleibt sichtbar, Konto bekommt nur die Differenz */
export async function correctClosing(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("closing.manage");
  const decision = String(fd.get("decision") ?? "") as Decision;
  const res = await correctEmployeeClosing(admin, String(fd.get("closingId") ?? ""), String(fd.get("reason") ?? "").trim().slice(0, 300), decision || undefined);
  revalidatePath("/admin/monatsabschluss");
  revalidatePath("/admin/stundenkonten");
  return res;
}

const MANUAL: Record<string, { type: AccountTxType; sign: 1 | -1 | 0; label: string }> = {
  PAYOUT: { type: "PAYOUT", sign: -1, label: "Auszahlung" },
  TIME_OFF: { type: "TIME_OFF", sign: -1, label: "Freizeitausgleich" },
  PLUS: { type: "MANUAL_CORRECTION", sign: 1, label: "Korrektur +" },
  MINUS: { type: "MANUAL_CORRECTION", sign: -1, label: "Korrektur −" },
};

/** Manuelle Kontobuchung mit Pflicht-Grund. Buchungen sind unveränderlich; Fehler werden durch Gegenbuchung ausgeglichen. */
export async function addAccountBooking(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("accounts.manage");
  const employeeId = String(fd.get("employeeId") ?? ""), date = String(fd.get("date") ?? "");
  const kind = MANUAL[String(fd.get("kind") ?? "")];
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300);
  const minutes = await parseHours(String(fd.get("hours") ?? "").trim());
  if (!kind || !employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Bitte Art und Datum angeben." };
  if (!minutes || Number.isNaN(minutes)) return { error: "Stunden bitte als 2:30 oder 2,5 eingeben." };
  if (reason.length < 5) return { error: "Bitte einen Grund angeben." };
  const signed = kind.sign * minutes;
  await prisma.$transaction(async (tx) => {
    const acc = await tx.workingTimeAccount.upsert({ where: { employeeId }, create: { employeeId, openedAt: dbDate(date) }, update: {} });
    const t = await tx.workingTimeTransaction.create({ data: { accountId: acc.id, bookingDate: dbDate(date), type: kind.type, minutes: signed, reason: `${kind.label}: ${reason}`, createdById: admin.id } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "ACCOUNT_BOOKED", entityType: "WorkingTimeTransaction", entityId: t.id, employeeId, after: { type: kind.type, minutes: signed, date, reason } });
  });
  revalidatePath("/admin/stundenkonten");
  return { ok: `Gebucht: ${kind.label} ${signed > 0 ? "+" : ""}${fmtMinutes(signed)} Std.` };
}

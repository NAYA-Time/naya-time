"use server";
import { revalidatePath } from "next/cache";
import type { DeptFilter, ReportType } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { nextRunAt, runSchedule } from "./reports/runner";
import type { FormState } from "./admin-actions-auth";
import { mailConfigured, sendMail } from "./mail";
import { sickReport } from "./reports/excel";
import { saveReport } from "./reports/store";

const back = () => revalidatePath("/admin/email");

export async function addRecipient(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("reports.email");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim().slice(0, 80) || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Bitte eine gültige E-Mail-Adresse angeben." };
  const r = await prisma.emailRecipient.upsert({ where: { email }, update: { active: true, name }, create: { email, name } });
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "RECIPIENT_SAVED", entityType: "EmailRecipient", entityId: r.id, after: { email } }));
  back();
  return { ok: `${email} gespeichert.` };
}

export async function toggleRecipient(fd: FormData): Promise<void> {
  const admin = await requireAdmin("reports.email");
  const id = String(fd.get("id"));
  const r = await prisma.emailRecipient.findUniqueOrThrow({ where: { id } });
  await prisma.emailRecipient.update({ where: { id }, data: { active: !r.active } });
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: r.active ? "RECIPIENT_DISABLED" : "RECIPIENT_ENABLED", entityType: "EmailRecipient", entityId: id }));
  back();
}

export async function saveSchedule(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("reports.email");
  const reportType = String(fd.get("reportType")) as ReportType;
  const deptFilter = (String(fd.get("deptFilter") || "ALL")) as DeptFilter;
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const timeOfDay = String(fd.get("timeOfDay") ?? "08:00");
  const dayOfWeek = Number(fd.get("dayOfWeek") || 1), dayOfMonth = Number(fd.get("dayOfMonth") || 1);
  const recipientIds = fd.getAll("recipients").map(String);
  if (!["WEEKLY", "MONTHLY", "PAYROLL_HOURLY"].includes(reportType) || !["ALL", "KUECHE", "SERVICE"].includes(deptFilter)) return { error: "Ungültige Auswahl." };
  if (!name) return { error: "Bitte einen Namen angeben." };
  if (!/^\d{2}:\d{2}$/.test(timeOfDay)) return { error: "Bitte eine Uhrzeit angeben." };
  if (dayOfMonth < 1 || dayOfMonth > 28) return { error: "Tag im Monat bitte zwischen 1 und 28." };
  if (!recipientIds.length) return { error: "Bitte mindestens einen Empfänger auswählen." };
  const base = { reportType, deptFilter, name, timeOfDay, dayOfWeek: reportType === "WEEKLY" ? dayOfWeek : null, dayOfMonth: reportType === "WEEKLY" ? null : dayOfMonth };
  const s = await prisma.reportSchedule.create({ data: { ...base, nextRunAt: nextRunAt(base, new Date()), recipients: { create: recipientIds.map((recipientId) => ({ recipientId })) } } });
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SCHEDULE_SAVED", entityType: "ReportSchedule", entityId: s.id, after: { ...base, recipients: recipientIds.length } }));
  back();
  return { ok: `„${name}“ angelegt. Nächster Versand: ${s.nextRunAt!.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}.` };
}

export async function toggleSchedule(fd: FormData): Promise<void> {
  const admin = await requireAdmin("reports.email");
  const id = String(fd.get("id"));
  const s = await prisma.reportSchedule.findUniqueOrThrow({ where: { id } });
  await prisma.reportSchedule.update({ where: { id }, data: { enabled: !s.enabled, nextRunAt: !s.enabled ? nextRunAt(s, new Date()) : s.nextRunAt } });
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: s.enabled ? "SCHEDULE_DISABLED" : "SCHEDULE_ENABLED", entityType: "ReportSchedule", entityId: id }));
  back();
}

export async function sendScheduleNow(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("reports.email");
  const s = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: String(fd.get("id")) }, include: { recipients: { include: { recipient: true } } } });
  const r = await runSchedule(prisma, s, new Date(), admin.id);
  back();
  if (r.note && !r.sent && !r.failed) return { error: r.note };
  return r.failed ? { error: `${r.sent} gesendet, ${r.failed} fehlgeschlagen – siehe Versandprotokoll.` } : { ok: `Gesendet an ${r.sent} Empfänger.` };
}

/** Empfänger eines geplanten Versands ändern */
export async function setScheduleRecipients(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("reports.email");
  const id = String(fd.get("id"));
  const recipientIds = fd.getAll("recipients").map(String);
  if (!recipientIds.length) return { error: "Bitte mindestens einen Empfänger auswählen (oder den Versand pausieren)." };
  await prisma.$transaction(async (tx) => {
    await tx.reportScheduleRecipient.deleteMany({ where: { scheduleId: id } });
    await tx.reportScheduleRecipient.createMany({ data: recipientIds.map((recipientId) => ({ scheduleId: id, recipientId })) });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SCHEDULE_RECIPIENTS_CHANGED", entityType: "ReportSchedule", entityId: id, after: { recipients: recipientIds.length } });
  });
  back();
  return { ok: "Empfänger gespeichert." };
}

/** Krankheitsliste per E-Mail – nur auf ausdrücklichen Klick (Freigabe), an ausgewählte Empfänger */
export async function sendSickList(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("reports.email");
  const from = String(fd.get("von") ?? ""), to = String(fd.get("bis") ?? "");
  const filter = (["ALL", "KUECHE", "SERVICE"] as const).find((f) => f === fd.get("abteilung")) ?? "ALL";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return { error: "Bitte einen gültigen Zeitraum wählen." };
  const ids = fd.getAll("recipient").map(String);
  const recipients = await prisma.emailRecipient.findMany({ where: { id: { in: ids }, active: true } });
  if (!recipients.length) return { error: "Bitte mindestens einen Empfänger auswählen." };
  if (!mailConfigured()) return { error: "E-Mail-Versand ist noch nicht eingerichtet (SMTP-Daten fehlen). Die Liste kann trotzdem heruntergeladen werden." };
  const built = await sickReport(prisma, from, to, filter);
  const { report, buffer } = await saveReport(prisma, built, "SICK_LIST", filter, admin.id);
  let sent = 0;
  const failed: string[] = [];
  for (const r of recipients) {
    try {
      const res = await sendMail(r.email, "NAYA TIME – Krankheitsliste", `Guten Tag,\n\nim Anhang die Krankheitsliste vom ${from.split("-").reverse().join(".")} bis ${to.split("-").reverse().join(".")} (${built.count} Krankmeldungen, nach Mitarbeitern sortiert).\n\nFreigegeben von ${admin.name}. Erstellt mit NAYA TIME.`, { filename: built.fileName, content: buffer });
      await prisma.emailDeliveryLog.create({ data: { reportId: report.id, recipient: r.email, status: "SENT", providerId: res.providerId } });
      sent++;
    } catch (e) {
      await prisma.emailDeliveryLog.create({ data: { reportId: report.id, recipient: r.email, status: "FAILED", error: (e as Error).message.slice(0, 300) } });
      failed.push(r.email);
    }
  }
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "REPORT_SENT", entityType: "GeneratedReport", entityId: report.id, after: { type: "SICK_LIST", from, to, sent, failed } }));
  return failed.length ? { error: `${sent} gesendet, fehlgeschlagen an: ${failed.join(", ")}.` } : { ok: `Krankheitsliste an ${sent} Empfänger gesendet.` };
}

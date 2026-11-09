"use server";
// Fristen und Erinnerungen je Mitarbeiter anlegen, erledigen, löschen, Terminal-Hinweis an/aus.
import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { dbDate } from "./time";
import { REMINDER_KINDS, addMonths } from "./calc/reminders";
import type { FormState } from "./admin-actions-auth";

const back = (id: string) => { revalidatePath(`/admin/mitarbeiter/${id}`); revalidatePath("/admin"); };

export async function addReminder(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("employees.manage");
  const employeeId = String(fd.get("id")), kind = String(fd.get("kind") ?? "OTHER"), due = String(fd.get("dueDate") ?? "");
  const preset = REMINDER_KINDS[kind];
  if (!preset) return { error: "Bitte eine Art wählen." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: "Bitte ein Datum angeben." };
  const title = String(fd.get("title") ?? "").trim() || preset.label;
  const daysRaw = String(fd.get("days") ?? "").trim();
  const days = daysRaw === "" ? preset.days : Number(daysRaw);
  if (!Number.isInteger(days) || days < 0 || days > 365) return { error: "Vorlauf bitte in Tagen (0–365)." };
  const r = await prisma.$transaction(async (tx) => {
    const r = await tx.employeeReminder.create({ data: { employeeId, kind, title, dueDate: dbDate(due), remindDaysBefore: days, repeatMonths: preset.repeat, showOnTerminal: fd.get("terminal") === "on", terminalText: String(fd.get("text") ?? "").trim() || null, createdById: admin.id } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "REMINDER_CREATED", entityType: "EmployeeReminder", entityId: r.id, employeeId, after: { kind, title, due, days, terminal: r.showOnTerminal } });
    return r;
  });
  back(employeeId);
  return { ok: `Frist „${r.title}“ gespeichert.` };
}

/** erledigt / Terminal an-aus / löschen */
export async function reminderAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin("employees.manage");
  const id = String(fd.get("rid")), op = String(fd.get("op"));
  const r = await prisma.employeeReminder.findUniqueOrThrow({ where: { id } });
  await prisma.$transaction(async (tx) => {
    if (op === "done") {
      await tx.employeeReminder.update({ where: { id }, data: { doneAt: new Date(), doneById: admin.id } });
      // wiederkehrend (z. B. Belehrung alle 2 Jahre): nächste Frist automatisch anlegen
      if (r.repeatMonths) await tx.employeeReminder.create({ data: { employeeId: r.employeeId, kind: r.kind, title: r.title, dueDate: dbDate(addMonths(new Date().toISOString().slice(0, 10), r.repeatMonths)), remindDaysBefore: r.remindDaysBefore, repeatMonths: r.repeatMonths, showOnTerminal: r.showOnTerminal, terminalText: r.terminalText, createdById: admin.id } });
    } else if (op === "terminal") await tx.employeeReminder.update({ where: { id }, data: { showOnTerminal: !r.showOnTerminal } });
    else if (op === "delete") await tx.employeeReminder.delete({ where: { id } });
    else return;
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: `REMINDER_${op.toUpperCase()}`, entityType: "EmployeeReminder", entityId: id, employeeId: r.employeeId, before: { title: r.title, due: r.dueDate, terminal: r.showOnTerminal } });
  });
  back(r.employeeId);
}

"use server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { berlinDate, berlinTime, berlinToInstant, dbDate } from "./time";
import type { FormState } from "./admin-actions-auth";
import { DEFAULT_SHIFT_KEY, defaultShift } from "./schedule-defaults";

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Montag der Woche zu einem Datum */
export async function mondayOf(ymd: string): Promise<string> {
  const d = new Date(ymd + "T12:00:00Z");
  return addDays(ymd, -((d.getUTCDay() + 6) % 7));
}

async function weekSchedule(tx: Prisma.TransactionClient, monday: string, adminId: string) {
  const existing = await tx.workSchedule.findFirst({ where: { periodStart: dbDate(monday), departmentId: null } });
  return existing ?? tx.workSchedule.create({ data: { periodStart: dbDate(monday), periodEnd: dbDate(addDays(monday, 6)), createdById: adminId } });
}

export async function addShift(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("schedule.manage");
  const employeeId = String(fd.get("employeeId") ?? ""), date = String(fd.get("date") ?? "");
  const start = String(fd.get("start") ?? ""), endRaw = String(fd.get("end") ?? "");
  const def = await defaultShift();
  const brkRaw = String(fd.get("break") ?? "").trim();
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || (endRaw && !/^\d{2}:\d{2}$/.test(endRaw))) return { error: "Bitte Mitarbeiter, Datum und Beginn angeben." };
  // Nur Anfangszeit → Standarddienst (Gunnar: 8,5 Std. inkl. 30 Min. Pause, änderbar)
  const brk = brkRaw === "" ? (endRaw ? 0 : def.breakMinutes) : Number(brkRaw);
  if (!Number.isInteger(brk) || brk < 0 || brk > 180) return { error: "Pause bitte in Minuten (0–180)." };
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const startAt = berlinToInstant(date, start);
  const endAt = endRaw ? berlinToInstant(endRaw <= start ? addDays(date, 1) : date, endRaw) : new Date(startAt.getTime() + def.minutes * 60000); // Ende vor Beginn = über Mitternacht
  const end = berlinTime(endAt);
  const departmentId = String(fd.get("departmentId") ?? "") || emp.primaryDeptId;
  const monday = await mondayOf(date);
  await prisma.$transaction(async (tx) => {
    const sched = await weekSchedule(tx, monday, admin.id);
    const sh = await tx.scheduledShift.create({ data: { scheduleId: sched.id, employeeId, departmentId, workDate: dbDate(date), startAt, endAt, plannedBreakMinutes: brk, note: String(fd.get("note") ?? "") || null } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SHIFT_CREATED", entityType: "ScheduledShift", entityId: sh.id, employeeId, after: { date, start, end, brk } });
  });
  revalidatePath("/admin/dienstplan");
  return { ok: `Dienst eingetragen: ${emp.firstName}, ${date.split("-").reverse().join(".")} ${start}–${end}.` };
}

export async function deleteShift(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("schedule.manage");
  const id = String(fd.get("id"));
  await prisma.$transaction(async (tx) => {
    const s = await tx.scheduledShift.update({ where: { id }, data: { deletedAt: new Date() } }); // weich gelöscht, Historie bleibt
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SHIFT_DELETED", entityType: "ScheduledShift", entityId: id, employeeId: s.employeeId, before: { start: s.startAt, end: s.endAt } });
  });
  revalidatePath("/admin/dienstplan");
  return { ok: "Dienst entfernt." };
}

export async function copyPreviousWeek(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("schedule.manage");
  const monday = String(fd.get("monday"));
  const prevMonday = addDays(monday, -7);
  const [prev, current] = await Promise.all([
    prisma.scheduledShift.findMany({ where: { deletedAt: null, workDate: { gte: dbDate(prevMonday), lte: dbDate(addDays(prevMonday, 6)) }, employee: { active: true } } }),
    prisma.scheduledShift.count({ where: { deletedAt: null, workDate: { gte: dbDate(monday), lte: dbDate(addDays(monday, 6)) } } }),
  ]);
  if (current > 0) return { error: "Diese Woche enthält bereits Dienste. Kopieren geht nur in eine leere Woche." };
  if (!prev.length) return { error: "Die Vorwoche enthält keine Dienste." };
  await prisma.$transaction(async (tx) => {
    const sched = await weekSchedule(tx, monday, admin.id);
    for (const s of prev) {
      // Wandzeit übernehmen (nicht +168 Std.), damit Dienste auch über die Zeitumstellung gleich bleiben
      const d = addDays(berlinDate(s.workDate), 7);
      const startAt = s.startAt ? berlinToInstant(d, berlinTime(s.startAt)) : null;
      const endDay = s.endAt && s.startAt && berlinDate(s.endAt) !== berlinDate(s.startAt) ? addDays(d, 1) : d;
      const endAt = s.endAt ? berlinToInstant(endDay, berlinTime(s.endAt)) : null;
      await tx.scheduledShift.create({ data: { scheduleId: sched.id, employeeId: s.employeeId, departmentId: s.departmentId, workDate: dbDate(d), kind: s.kind, startAt, endAt, plannedBreakMinutes: s.plannedBreakMinutes, note: s.note } });
    }
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SCHEDULE_COPIED", entityType: "WorkSchedule", entityId: sched.id, after: { from: prevMonday, to: monday, shifts: prev.length } });
  });
  revalidatePath("/admin/dienstplan");
  return { ok: `${prev.length} Dienste aus der Vorwoche übernommen.` };
}

/** Veröffentlichen friert den aktuellen Stand als Version ein (Nachweis, Historie). */
export async function publishWeek(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("schedule.manage");
  const monday = String(fd.get("monday"));
  const n = await prisma.$transaction(async (tx) => {
    const sched = await weekSchedule(tx, monday, admin.id);
    const shifts = await tx.scheduledShift.findMany({ where: { deletedAt: null, workDate: { gte: dbDate(monday), lte: dbDate(addDays(monday, 6)) } }, orderBy: { startAt: "asc" } });
    const versionNo = sched.currentVersionNo + 1;
    await tx.scheduleVersion.create({
      data: { scheduleId: sched.id, versionNo, publishedById: admin.id, changeNote: String(fd.get("note") ?? "") || null,
        snapshot: shifts.map((s) => ({ id: s.id, employeeId: s.employeeId, departmentId: s.departmentId, workDate: berlinDate(s.workDate), startAt: s.startAt?.toISOString() ?? null, endAt: s.endAt?.toISOString() ?? null, plannedBreakMinutes: s.plannedBreakMinutes })) },
    });
    await tx.workSchedule.update({ where: { id: sched.id }, data: { status: "PUBLISHED", currentVersionNo: versionNo } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SCHEDULE_PUBLISHED", entityType: "WorkSchedule", entityId: sched.id, after: { versionNo, shifts: shifts.length } });
    return versionNo;
  });
  revalidatePath("/admin/dienstplan");
  return { ok: `Dienstplan veröffentlicht (Version ${n}).` };
}

/** Für das kleine ×-Formular direkt im Wochenraster */
export async function deleteShiftQuick(fd: FormData): Promise<void> {
  await deleteShift(undefined, fd);
}

/** Standarddienst ändern (Dauer inkl. Pause und Pausenlänge) */
export async function saveDefaultShift(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("schedule.manage");
  const m = String(fd.get("duration") ?? "").trim().match(/^(\d{1,2})(?::([0-5]\d)|[,.](\d+))?$/);
  const minutes = m ? Number(m[1]) * 60 + (m[2] ? Number(m[2]) : m[3] ? Math.round(Number("0." + m[3]) * 60) : 0) : NaN;
  const breakMinutes = Number(fd.get("breakMinutes") ?? "");
  if (!Number.isFinite(minutes) || minutes < 60 || minutes > 14 * 60) return { error: "Dauer bitte als 8:30 oder 8,5 angeben (1 bis 14 Std.)." };
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 120 || breakMinutes >= minutes) return { error: "Pause bitte in Minuten (0–120)." };
  const before = await defaultShift();
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({ where: { key: DEFAULT_SHIFT_KEY }, update: { value: { minutes, breakMinutes }, updatedById: admin.id }, create: { key: DEFAULT_SHIFT_KEY, value: { minutes, breakMinutes }, updatedById: admin.id } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SETTING_CHANGED", entityType: "SystemSetting", entityId: DEFAULT_SHIFT_KEY, before, after: { minutes, breakMinutes } });
  });
  revalidatePath("/admin/dienstplan");
  return { ok: `Standarddienst: ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} Std. inkl. ${breakMinutes} Min. Pause.` };
}

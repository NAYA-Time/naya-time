// Dienstplan-Foto: geprüfte Tabelle als Dienste speichern (ohne Next.js, direkt testbar).
import { prisma } from "./db";
import { audit } from "./audit";
import { berlinDate, berlinTime, berlinToInstant, dbDate } from "./time";
import { defaultShift } from "./schedule-defaults";
import { buildProposal, mondayOfYmd, shiftsToSave, type CellKind, type ExtractedPlan, type PlanEmployee, type Proposal } from "./calc/plan-import";

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export async function planEmployees(): Promise<PlanEmployee[]> {
  return prisma.employee.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true, displayName: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
}

/** Vorhandene Dienste der Woche als "employeeId|datum" → "15:00–23:30" */
async function existingShifts(monday: string): Promise<Map<string, string>> {
  const shifts = await prisma.scheduledShift.findMany({ where: { deletedAt: null, kind: "WORK", workDate: { gte: dbDate(monday), lte: dbDate(addDays(monday, 6)) } }, orderBy: { startAt: "asc" } });
  const m = new Map<string, string>();
  for (const s of shifts) {
    const k = `${s.employeeId}|${berlinDate(s.workDate)}`;
    const t = `${s.startAt ? berlinTime(s.startAt) : "?"}–${s.endAt ? berlinTime(s.endAt) : "?"}`;
    m.set(k, m.has(k) ? `${m.get(k)}, ${t}` : t);
  }
  return m;
}

export async function proposalFor(plan: ExtractedPlan, fallbackMonday: string): Promise<Proposal> {
  const emps = await planEmployees();
  const first = buildProposal(plan, emps, fallbackMonday, new Map());
  return buildProposal(plan, emps, fallbackMonday, await existingShifts(first.monday));
}

export interface SaveInput { monday: string; replace: boolean; rows: { employeeId: string | null; cells: { date: string; kind: CellKind; start: string | null; end: string | null }[] }[] }

/**
 * Speichert die geprüften Dienste. Vorhandene Dienste am selben Tag bleiben stehen (übersprungen),
 * außer replace = true: dann werden sie weich gelöscht und ersetzt. Urlaub/Krank wird nicht automatisch gebucht.
 */
export async function savePlanImport(adminId: string, input: SaveInput): Promise<{ ok?: string; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.monday) || mondayOfYmd(input.monday) !== input.monday) return { error: "Ungültige Woche." };
  const days = new Set(Array.from({ length: 7 }, (_, i) => addDays(input.monday, i)));
  const wanted = shiftsToSave(input.rows).filter((s) => days.has(s.date));
  const absences = input.rows.flatMap((r) => (r.employeeId ? r.cells.filter((c) => c.kind === "VACATION" || c.kind === "SICK").map((c) => ({ employeeId: r.employeeId!, ...c })) : []));
  if (!wanted.length) return { error: "Es ist kein Dienst mit Uhrzeit und zugeordnetem Mitarbeiter ausgewählt." };
  const emps = await prisma.employee.findMany({ where: { id: { in: [...new Set([...wanted, ...absences].map((s) => s.employeeId))] }, active: true } });
  const byId = new Map(emps.map((e) => [e.id, e]));
  if (wanted.some((s) => !byId.has(s.employeeId))) return { error: "Ein ausgewählter Mitarbeiter ist nicht (mehr) aktiv. Bitte die Tabelle neu laden." };
  const def = await defaultShift();

  const res = await prisma.$transaction(async (tx) => {
    const sched = (await tx.workSchedule.findFirst({ where: { periodStart: dbDate(input.monday), departmentId: null } }))
      ?? (await tx.workSchedule.create({ data: { periodStart: dbDate(input.monday), periodEnd: dbDate(addDays(input.monday, 6)), createdById: adminId } }));
    let created = 0, skipped = 0, replaced = 0;
    for (const s of wanted) {
      const same = await tx.scheduledShift.findMany({ where: { deletedAt: null, kind: "WORK", employeeId: s.employeeId, workDate: dbDate(s.date) } });
      if (same.length && !input.replace) { skipped++; continue; }
      for (const old of same) {
        await tx.scheduledShift.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
        await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "SHIFT_DELETED", entityType: "ScheduledShift", entityId: old.id, employeeId: s.employeeId, before: { start: old.startAt, end: old.endAt }, reason: "Ersetzt durch Foto-Import" });
        replaced++;
      }
      const startAt = berlinToInstant(s.date, s.start);
      // Nur Anfangszeit → Standarddienst; mit Ende: Pause nach Länge (über 6 Std. Standardpause)
      const endAt = s.end ? berlinToInstant(s.end <= s.start ? addDays(s.date, 1) : s.date, s.end) : new Date(startAt.getTime() + def.minutes * 60000);
      const brk = s.end ? ((endAt.getTime() - startAt.getTime()) / 60000 > 360 ? def.breakMinutes : 0) : def.breakMinutes;
      const sh = await tx.scheduledShift.create({ data: { scheduleId: sched.id, employeeId: s.employeeId, departmentId: byId.get(s.employeeId)!.primaryDeptId, workDate: dbDate(s.date), startAt, endAt, plannedBreakMinutes: brk, note: s.end ? "aus Foto" : "aus Foto, nur Beginn" } });
      await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "SHIFT_CREATED", entityType: "ScheduledShift", entityId: sh.id, employeeId: s.employeeId, after: { date: s.date, start: s.start, end: berlinTime(endAt), brk, source: "PLAN_PHOTO" } });
      created++;
    }
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "SCHEDULE_PHOTO_IMPORTED", entityType: "WorkSchedule", entityId: sched.id, after: { monday: input.monday, created, skipped, replaced } });
    return { created, skipped, replaced };
  });

  const parts = [`${res.created} Dienste übernommen`];
  if (res.replaced) parts.push(`${res.replaced} vorhandene ersetzt`);
  if (res.skipped) parts.push(`${res.skipped} übersprungen, weil an dem Tag schon ein Dienst steht`);
  let msg = parts.join(", ") + ".";
  if (absences.length) {
    const names = [...new Set(absences.map((a) => { const e = byId.get(a.employeeId); return e ? e.firstName : null; }).filter(Boolean))];
    msg += ` Urlaub/Krank laut Foto (${names.join(", ") || absences.length + " Tage"}) bitte unter Abwesenheiten eintragen – das wird nicht automatisch gebucht.`;
  }
  return { ok: msg };
}

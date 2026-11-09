"use server";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EmploymentType, MonthlyTargetMethod } from "@prisma/client";
import { prisma } from "./db";
import { minimumWageCents } from "./calc/minwage";
import { audit } from "./audit";
import { hashSecret } from "./crypto";
import { requireAdmin } from "./admin-auth";
import { dbDate } from "./time";
import type { FormState } from "./admin-actions-auth";

const TYPES: EmploymentType[] = ["FESTANGESTELLT", "MINIJOB", "KURZFRISTIG", "TEILZEIT_STUNDENLOHN", "SONSTIGE_AUSHILFE"];
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** "42:30" oder "42,5" → Minuten */
export async function parseHours(v: string): Promise<number | null> {
  if (!v) return null;
  const m = v.match(/^(\d{1,3}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : NaN;
}
function euroToCents(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : NaN;
}
async function newSetupCode() {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return { code, hash: await hashSecret(code), expiresAt: new Date(Date.now() + 7 * 86400_000) };
}

export async function createEmployee(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("employees.manage");
  const firstName = s(fd, "firstName"), lastName = s(fd, "lastName"), personnelNumber = s(fd, "personnelNumber");
  const employmentType = s(fd, "employmentType") as EmploymentType;
  const primaryDeptId = s(fd, "primaryDeptId"), subDeptId = s(fd, "subDeptId") || null;
  const entryDate = s(fd, "entryDate");
  if (!firstName || !lastName || !personnelNumber) return { error: "Vorname, Nachname und Personalnummer sind Pflicht." };
  if (!TYPES.includes(employmentType)) return { error: "Bitte die Beschäftigungsart wählen." };
  if (!dateOk(entryDate)) return { error: "Bitte das Eintrittsdatum angeben." };
  if (await prisma.employee.findUnique({ where: { personnelNumber } })) return { error: "Diese Personalnummer ist schon vergeben." };
  const hourly = employmentType !== "FESTANGESTELLT";
  const weekly = await parseHours(s(fd, "weeklyHours"));
  if (Number.isNaN(weekly)) return { error: "Wochenstunden bitte als 42:30 oder 42,5 eingeben." };
  if (!hourly && weekly == null) return { error: "Für Festangestellte bitte die Wochenstunden angeben." };
  const wage = euroToCents(s(fd, "wage"));
  if (hourly && (wage == null || Number.isNaN(wage))) return { error: "Für Aushilfen bitte einen Stundenlohn angeben (z. B. 15,00)." };
  if (hourly && !admin.permissions.has("wages.manage")) return { error: "Dir fehlt die Berechtigung, Stundenlöhne festzulegen." };
  const included = Number(s(fd, "includedHours") || "0");
  const email = s(fd, "email") || null;

  const setup = await newSetupCode();
  const emp = await prisma.$transaction(async (tx) => {
    const e = await tx.employee.create({
      data: {
        firstName, lastName, personnelNumber, email, position: s(fd, "position") || null, employmentType,
        displayName: `${firstName} ${lastName[0]}.`, primaryDeptId, subDeptId, entryDate: dbDate(entryDate),
        contracts: {
          create: {
            validFrom: dbDate(entryDate), payModel: hourly ? "HOURLY" : "SALARIED", weeklyMinutes: weekly,
            workdaysPerWeek: Number(s(fd, "workdaysPerWeek") || "5"), vacationDaysPerYear: Number(s(fd, "vacationDays") || "0"), createdById: admin.id,
          },
        },
        departmentHistory: { create: { departmentId: primaryDeptId, validFrom: dbDate(entryDate) } },
        credential: { create: { mustSetPin: true, setupCodeHash: setup.hash, setupCodeExpiresAt: setup.expiresAt } },
        portalSettings: { create: {} },
        account: { create: { openedAt: dbDate(entryDate) } },
      },
    });
    if (hourly) await tx.hourlyWageHistory.create({ data: { employeeId: e.id, validFrom: dbDate(entryDate), centsPerHour: wage!, createdById: admin.id } });
    else await tx.overtimeRule.create({ data: { employeeId: e.id, validFrom: dbDate(entryDate), includedMinutesPerMonth: Math.round(included * 60), contractuallyAgreed: fd.get("agreed") === "on", createdById: admin.id } });
    const opening = await parseHours(s(fd, "openingBalance").replace(/^-/, ""));
    if (opening && !Number.isNaN(opening)) {
      const acc = await tx.workingTimeAccount.findUniqueOrThrow({ where: { employeeId: e.id } });
      await tx.workingTimeTransaction.create({ data: { accountId: acc.id, bookingDate: dbDate(entryDate), type: "OPENING_BALANCE", minutes: s(fd, "openingBalance").startsWith("-") ? -opening : opening, reason: "Anfangsbestand bei Anlage", createdById: admin.id } });
    }
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "EMPLOYEE_CREATED", entityType: "Employee", entityId: e.id, employeeId: e.id, after: { firstName, lastName, personnelNumber, employmentType } });
    return e;
  });
  redirect(`/admin/mitarbeiter/${emp.id}?code=${setup.code}`);
}

export async function updateEmployee(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("employees.manage");
  const id = s(fd, "id");
  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });
  const data = {
    firstName: s(fd, "firstName"), lastName: s(fd, "lastName"), displayName: s(fd, "displayName") || before.displayName,
    email: s(fd, "email") || null, position: s(fd, "position") || null, subDeptId: s(fd, "subDeptId") || null,
    exitDate: dateOk(s(fd, "exitDate")) ? dbDate(s(fd, "exitDate")) : null, showOnTerminal: fd.get("showOnTerminal") === "on",
  };
  const newDept = s(fd, "primaryDeptId");
  const deptFrom = s(fd, "deptValidFrom");
  if (newDept !== before.primaryDeptId && !dateOk(deptFrom)) return { error: "Für den Abteilungswechsel bitte „gültig ab“ angeben." };
  await prisma.$transaction(async (tx) => {
    if (newDept !== before.primaryDeptId) {
      await tx.employeeDepartmentHistory.updateMany({ where: { employeeId: id, validTo: null }, data: { validTo: new Date(dbDate(deptFrom).getTime() - 86400000) } });
      await tx.employeeDepartmentHistory.create({ data: { employeeId: id, departmentId: newDept, validFrom: dbDate(deptFrom) } });
    }
    await tx.employee.update({ where: { id }, data: { ...data, primaryDeptId: newDept } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "EMPLOYEE_UPDATED", entityType: "Employee", entityId: id, employeeId: id, before, after: { ...data, primaryDeptId: newDept } });
  });
  revalidatePath(`/admin/mitarbeiter/${id}`);
  return { ok: "Gespeichert." };
}

/** Neuer Vertragsstand ab Datum. Der bisherige endet am Vortag – alte Werte bleiben für frühere Zeiträume gültig. */
export async function addContract(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("contracts.manage");
  const id = s(fd, "id"), from = s(fd, "validFrom");
  if (!dateOk(from)) return { error: "Bitte „gültig ab“ angeben." };
  const weekly = await parseHours(s(fd, "weeklyHours"));
  if (Number.isNaN(weekly)) return { error: "Wochenstunden bitte als 42:30 oder 42,5 eingeben." };
  const last = await prisma.employeeContract.findFirst({ where: { employeeId: id }, orderBy: { validFrom: "desc" } });
  if (last && dbDate(from) <= last.validFrom) return { error: "Das Datum muss nach dem Beginn des aktuellen Vertragsstands liegen." };
  const closed = await prisma.monthlyTimeClosing.findFirst({ where: { employeeId: id, status: "CLOSED", month: { gte: new Date(dbDate(from).getTime() - 31 * 86400000) } } });
  await prisma.$transaction(async (tx) => {
    if (last) await tx.employeeContract.update({ where: { id: last.id }, data: { validTo: new Date(dbDate(from).getTime() - 86400000) } });
    const c = await tx.employeeContract.create({
      data: {
        employeeId: id, validFrom: dbDate(from), payModel: last?.payModel ?? "SALARIED", weeklyMinutes: weekly,
        monthlyTargetMethod: (s(fd, "method") || "WEEKLY_AVERAGE") as MonthlyTargetMethod, workdaysPerWeek: Number(s(fd, "workdaysPerWeek") || "5"),
        vacationDaysPerYear: Number(s(fd, "vacationDays") || "0"), note: s(fd, "note") || null, createdById: admin.id,
      },
    });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "CONTRACT_ADDED", entityType: "EmployeeContract", entityId: c.id, employeeId: id, before: last, after: c });
  });
  revalidatePath(`/admin/mitarbeiter/${id}`);
  return { ok: closed ? "Gespeichert. Achtung: Ein betroffener Monat ist bereits abgeschlossen und muss ggf. korrigiert werden." : "Neuer Vertragsstand gespeichert." };
}

export async function addOvertimeRule(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("contracts.manage");
  const id = s(fd, "id"), from = s(fd, "validFrom");
  if (!dateOk(from)) return { error: "Bitte „gültig ab“ angeben." };
  const hours = Number(s(fd, "includedHours").replace(",", "."));
  if (!Number.isFinite(hours) || hours < 0 || hours > 60) return { error: "Bitte eine Stundenzahl zwischen 0 und 60 angeben." };
  const last = await prisma.overtimeRule.findFirst({ where: { employeeId: id }, orderBy: { validFrom: "desc" } });
  if (last && dbDate(from) <= last.validFrom) return { error: "Das Datum muss nach dem Beginn der aktuellen Regel liegen." };
  await prisma.$transaction(async (tx) => {
    if (last) await tx.overtimeRule.update({ where: { id: last.id }, data: { validTo: new Date(dbDate(from).getTime() - 86400000) } });
    const r = await tx.overtimeRule.create({
      data: { employeeId: id, validFrom: dbDate(from), includedMinutesPerMonth: Math.round(hours * 60), contractuallyAgreed: fd.get("agreed") === "on", legallyReviewed: fd.get("reviewed") === "on", note: s(fd, "note") || null, createdById: admin.id },
    });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "OVERTIME_RULE_ADDED", entityType: "OvertimeRule", entityId: r.id, employeeId: id, before: last, after: r });
  });
  revalidatePath(`/admin/mitarbeiter/${id}`);
  return { ok: "Abgeltungsregel gespeichert." };
}

export async function addWage(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("wages.manage");
  const id = s(fd, "id"), from = s(fd, "validFrom");
  if (!dateOk(from)) return { error: "Bitte „gültig ab“ angeben." };
  const cents = euroToCents(s(fd, "wage"));
  if (cents == null || Number.isNaN(cents)) return { error: "Bitte einen Stundenlohn angeben (z. B. 15,00)." };
  const last = await prisma.hourlyWageHistory.findFirst({ where: { employeeId: id }, orderBy: { validFrom: "desc" } });
  if (last && dbDate(from) <= last.validFrom) return { error: "Das Datum muss nach dem Beginn des aktuellen Stundenlohns liegen." };
  await prisma.$transaction(async (tx) => {
    if (last) await tx.hourlyWageHistory.update({ where: { id: last.id }, data: { validTo: new Date(dbDate(from).getTime() - 86400000) } });
    const w = await tx.hourlyWageHistory.create({ data: { employeeId: id, validFrom: dbDate(from), centsPerHour: cents, createdById: admin.id } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "WAGE_ADDED", entityType: "HourlyWageHistory", entityId: w.id, employeeId: id, before: last, after: w });
  });
  revalidatePath(`/admin/mitarbeiter/${id}`);
  const min = minimumWageCents(from);
  if (cents < min) return { error: `Gespeichert – aber ACHTUNG: ${(cents / 100).toFixed(2).replace(".", ",")} € liegt unter dem gesetzlichen Mindestlohn von ${(min / 100).toFixed(2).replace(".", ",")} € (ab ${from.split("-").reverse().join(".")}). Ausnahmen nur z. B. für Auszubildende oder Jugendliche ohne Berufsabschluss.` };
  return { ok: "Stundenlohn gespeichert." };
}

/** PIN-Rücksetzung: alter PIN sofort ungültig, Mitarbeiter wählt mit Einmalcode einen neuen. */
export async function resetPin(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("pins.reset");
  const id = s(fd, "id");
  const setup = await newSetupCode();
  await prisma.$transaction(async (tx) => {
    await tx.employeeCredential.update({ where: { employeeId: id }, data: { pinHash: null, mustSetPin: true, setupCodeHash: setup.hash, setupCodeExpiresAt: setup.expiresAt, failedAttempts: 0, lockedUntil: null } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "PIN_RESET", entityType: "Employee", entityId: id, employeeId: id });
  });
  revalidatePath(`/admin/mitarbeiter/${id}`);
  return { ok: `PIN zurückgesetzt. Einrichtungscode für den Mitarbeiter: ${setup.code} (7 Tage gültig, wird nur jetzt angezeigt).` };
}

export async function savePortalVisibility(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("employees.manage");
  const id = s(fd, "id");
  const keys = ["schedule", "weeklyTarget", "weeklyHours", "monthlyHours", "monthlyTarget", "accountBalance", "minusHours", "vacationRemaining", "vacationRequests"] as const;
  const data = Object.fromEntries(keys.map((k) => [k, fd.get(k) === "on"]));
  const enabled = fd.get("portalEnabled") === "on";
  await prisma.$transaction(async (tx) => {
    await tx.portalVisibility.upsert({ where: { employeeId: id }, update: data, create: { employeeId: id, ...data } });
    await tx.employeeCredential.update({ where: { employeeId: id }, data: { portalEnabled: enabled, ...(enabled ? {} : { portalInviteHash: null, portalInviteExpiresAt: null }) } });
    if (!enabled) await tx.session.deleteMany({ where: { employeeId: id, kind: "PORTAL" } }); // gesperrt = sofort abgemeldet
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "PORTAL_VISIBILITY", entityType: "Employee", entityId: id, employeeId: id, after: { enabled, ...data } });
  });
  revalidatePath(`/admin/mitarbeiter/${id}`);
  return { ok: enabled ? "Freigaben gespeichert. Änderungen gelten sofort am Handy." : "Gespeichert. Der Handy-Zugang ist gesperrt, der Mitarbeiter wurde abgemeldet." };
}

export async function setActive(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("employees.manage");
  const id = s(fd, "id");
  const active = fd.get("active") === "true";
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: { active } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: active ? "EMPLOYEE_ACTIVATED" : "EMPLOYEE_DEACTIVATED", entityType: "Employee", entityId: id, employeeId: id });
  });
  revalidatePath(`/admin/mitarbeiter/${id}`);
  return { ok: active ? "Mitarbeiter aktiviert." : "Mitarbeiter deaktiviert. Er erscheint nicht mehr am Terminal; alle Daten bleiben erhalten." };
}

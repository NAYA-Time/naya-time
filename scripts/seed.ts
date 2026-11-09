// Grunddaten: Abteilungen, Rollen, Rechte, Einstellungen. Mit --demo zusätzlich Test-Mitarbeiter und Dienstplan.
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../lib/crypto";
import { berlinDate, berlinToInstant, dbDate } from "../lib/time";

const prisma = new PrismaClient();
const demo = process.argv.includes("--demo");

const PERMISSIONS: [string, string][] = [
  ["dashboard.view", "Dashboard und Live-Anwesenheit sehen"],
  ["employees.view", "Mitarbeiterliste sehen"],
  ["employees.manage", "Mitarbeiter anlegen, ändern, deaktivieren"],
  ["contracts.manage", "Vertragsstunden und Überstundenregeln ändern"],
  ["wages.view", "Stundenlöhne sehen"],
  ["wages.manage", "Stundenlöhne ändern"],
  ["schedule.manage", "Dienstpläne erstellen und veröffentlichen"],
  ["absences.manage", "Krankheit und Urlaub eintragen"],
  ["timeclock.view", "Zeitbuchungen sehen"],
  ["timeclock.correct", "Zeitbuchungen korrigieren"],
  ["timeclock.addSession", "Vergessene Schichten komplett nachtragen (nur Inhaber und ausgewählte Personen)"],
  ["corrections.request", "Korrekturen anfragen"],
  ["accounts.manage", "Stundenkonten korrigieren"],
  ["closing.manage", "Monatsabschluss durchführen"],
  ["payroll.manage", "Aushilfen abrechnen, Auszahlungen bestätigen"],
  ["reports.create", "Berichte erstellen"],
  ["reports.email", "E-Mail-Empfänger und Versand verwalten"],
  ["photos.view", "Buchungsfotos ansehen"],
  ["admins.manage", "Administratoren und Rechte verwalten"],
  ["settings.manage", "Einstellungen ändern"],
  ["terminal.manage", "Terminals koppeln und sperren"],
  ["pins.reset", "PIN zurücksetzen"],
];
const MANAGER_DEFAULT = ["dashboard.view", "employees.view", "schedule.manage", "timeclock.view", "corrections.request", "reports.create"];

async function main() {
  const depts = [
    { key: "KUECHE", name: "Küche", kind: "MAIN" as const, sortOrder: 1 },
    { key: "SERVICE", name: "Service", kind: "MAIN" as const, sortOrder: 2 },
  ];
  for (const d of depts) await prisma.department.upsert({ where: { key: d.key }, update: {}, create: d });
  const kueche = await prisma.department.findUniqueOrThrow({ where: { key: "KUECHE" } });
  const service = await prisma.department.findUniqueOrThrow({ where: { key: "SERVICE" } });
  const subs = [
    { key: "SUSHI", name: "Sushi", parentId: kueche.id, sortOrder: 3 },
    { key: "BAR", name: "Bar", parentId: service.id, sortOrder: 4 },
    { key: "LEITUNG", name: "Restaurantleitung", parentId: null, sortOrder: 5 },
    { key: "BUERO", name: "Büro", parentId: null, sortOrder: 6 },
    { key: "SONSTIGE", name: "Sonstige", parentId: null, sortOrder: 7 },
  ];
  for (const s of subs) await prisma.department.upsert({ where: { key: s.key }, update: {}, create: { ...s, kind: "SUB" } });

  for (const [key, description] of PERMISSIONS) await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  const owner = await prisma.role.upsert({ where: { key: "OWNER" }, update: {}, create: { key: "OWNER", name: "Inhaber", isSystem: true } });
  const manager = await prisma.role.upsert({ where: { key: "MANAGER" }, update: {}, create: { key: "MANAGER", name: "Restaurantleitung", isSystem: true } });
  await prisma.rolePermission.createMany({ data: PERMISSIONS.map(([k]) => ({ roleId: owner.id, permissionKey: k })), skipDuplicates: true });
  await prisma.rolePermission.createMany({ data: MANAGER_DEFAULT.map((k) => ({ roleId: manager.id, permissionKey: k })), skipDuplicates: true });

  const defaults: Record<string, unknown> = {
    "photo.enabled": false,
    "terminal.idleSeconds": 30,
    "terminal.confirmSeconds": 4,
    "terminal.photoCountdownSeconds": 2,
    "rules.missingClockOutHours": 14,
    "rules.lateToleranceMinutes": 5,
    "schedule.defaultShift": { minutes: 510, breakMinutes: 30 }, // nur Anfangszeit → 8:30 inkl. 30 Min. Pause
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }

  if (!demo) return console.log("Grunddaten angelegt.");

  // ── Demo-Daten (nur Testumgebung) ──
  await prisma.systemSetting.update({ where: { key: "photo.enabled" }, data: { value: true } });
  if (!(await prisma.dataProtectionApproval.findFirst())) {
    await prisma.dataProtectionApproval.create({
      data: { feature: "PHOTO_CAPTURE", status: "APPROVED", purpose: "TESTUMGEBUNG – keine echte Freigabe", legalBasis: "Test", retentionDays: 30, approvedAt: new Date() },
    });
  }
  const sushi = await prisma.department.findUniqueOrThrow({ where: { key: "SUSHI" } });
  const people = [
    { no: "1001", first: "Daniel", last: "Becker", dept: kueche.id, sub: null, pin: "246810", type: "FESTANGESTELLT" as const, weekly: 2550 },
    { no: "1002", first: "Rafa", last: "Moreno", dept: kueche.id, sub: null, pin: "135790", type: "FESTANGESTELLT" as const, weekly: 2550 },
    { no: "1003", first: "Hiro", last: "Tanaka", dept: kueche.id, sub: sushi.id, pin: "975310", type: "FESTANGESTELLT" as const, weekly: 2400 },
    { no: "2001", first: "Max", last: "Weber", dept: service.id, sub: null, pin: "864200", type: "MINIJOB" as const, weekly: null },
    { no: "2002", first: "Lena", last: "Schulz", dept: service.id, sub: null, pin: null, type: "FESTANGESTELLT" as const, weekly: 1800 },
  ];
  const today = berlinDate(new Date());
  for (const p of people) {
    const e = await prisma.employee.upsert({
      where: { personnelNumber: p.no },
      update: {},
      create: {
        personnelNumber: p.no, firstName: p.first, lastName: p.last, displayName: `${p.first} ${p.last[0]}.`, employmentType: p.type,
        primaryDeptId: p.dept, subDeptId: p.sub, entryDate: dbDate("2025-01-01"),
        contracts: { create: { validFrom: dbDate("2025-01-01"), payModel: p.type === "FESTANGESTELLT" ? "SALARIED" : "HOURLY", weeklyMinutes: p.weekly, vacationDaysPerYear: 26 } },
        credential: {
          create: p.pin
            ? { pinHash: await hashSecret(p.pin), pinSetAt: new Date(), mustSetPin: false }
            : { mustSetPin: true, setupCodeHash: await hashSecret("4711"), setupCodeExpiresAt: new Date(Date.now() + 7 * 86400000) },
        },
        portalSettings: { create: {} },
      },
    });
    if (p.type !== "FESTANGESTELLT") {
      if (!(await prisma.hourlyWageHistory.findFirst({ where: { employeeId: e.id } }))) {
        await prisma.hourlyWageHistory.create({ data: { employeeId: e.id, validFrom: dbDate("2025-01-01"), centsPerHour: 1500 } });
      }
    } else if (!(await prisma.overtimeRule.findFirst({ where: { employeeId: e.id } }))) {
      await prisma.overtimeRule.create({ data: { employeeId: e.id, validFrom: dbDate("2025-01-01"), includedMinutesPerMonth: 600, contractuallyAgreed: true } });
    }
  }

  // Dienstplan: heute und die nächsten 6 Tage, 13:30–22:00 (Hiro 12:00–20:30)
  let sched = await prisma.workSchedule.findFirst({ where: { periodStart: dbDate(today) } });
  if (!sched) {
    sched = await prisma.workSchedule.create({ data: { periodStart: dbDate(today), periodEnd: dbDate(berlinDate(new Date(Date.now() + 6 * 86400000))), status: "PUBLISHED" } });
    const emps = await prisma.employee.findMany();
    for (let i = 0; i < 7; i++) {
      const day = berlinDate(new Date(Date.now() + i * 86400000));
      for (const e of emps) {
        const [s, en] = e.firstName === "Hiro" ? ["12:00", "20:30"] : ["13:30", "22:00"];
        await prisma.scheduledShift.create({
          data: { scheduleId: sched.id, employeeId: e.id, departmentId: e.primaryDeptId, workDate: dbDate(day), startAt: berlinToInstant(day, s), endAt: berlinToInstant(day, en), plannedBreakMinutes: 30 },
        });
      }
    }
  }
  console.log("Demo-Daten angelegt. PINs: Daniel 246810, Rafa 135790, Hiro 975310, Max 864200; Lena: Einrichtungscode 4711");
}

main().finally(() => prisma.$disconnect());

// Löschkonzept: Löschen nur nach Ablauf der Frist, dann alle Daten weg, Änderungsprotokoll bleibt.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { hashSecret } from "../lib/crypto";
import { eraseEmployee } from "../lib/erasure";
import { stamp } from "../lib/stamp";
import { blobStore } from "../lib/storage";
import { berlinToInstant, dbDate } from "../lib/time";

const ADMIN = "00000000-0000-4000-8000-000000000001";
let terminalId = "", deptId = "";
beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } })).id;
  terminalId = (await prisma.terminalDevice.create({ data: { name: "Lösch-Test", tokenHash: randomUUID() } })).id;
  await prisma.systemSetting.upsert({ where: { key: "photo.enabled" }, update: { value: true }, create: { key: "photo.enabled", value: true } });
  if (!(await prisma.dataProtectionApproval.findFirst({ where: { status: "APPROVED" } }))) {
    await prisma.dataProtectionApproval.create({ data: { feature: "PHOTO_CAPTURE", status: "APPROVED", purpose: "Test", legalBasis: "Test", retentionDays: 30, approvedAt: new Date() } });
  }
});

describe("Löschen ehemaliger Mitarbeiter", () => {
  it("vor Fristablauf verweigert, danach alles gelöscht inkl. Fotodatei", async () => {
    const e = await prisma.employee.create({
      data: { personnelNumber: `L-${randomUUID().slice(0, 8)}`, firstName: "Lösch", lastName: "Test", displayName: "Lösch", employmentType: "FESTANGESTELLT",
        primaryDeptId: deptId, entryDate: dbDate("2026-01-01"), exitDate: dbDate("2026-03-31"), active: false,
        credential: { create: { pinHash: await hashSecret("482915"), mustSetPin: false } }, contracts: { create: { validFrom: dbDate("2026-01-01"), payModel: "SALARIED", weeklyMinutes: 2400 } },
        reminders: { create: { kind: "OTHER", title: "x", dueDate: dbDate("2026-02-01"), createdById: ADMIN } } },
    });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4000, 3)]);
    const a = await stamp({ employeeId: e.id, terminalId, type: "CLOCK_IN", idempotencyKey: randomUUID(), photo: { data: jpeg, mime: "image/jpeg" }, testNow: berlinToInstant("2026-03-02", "12:00") });
    await stamp({ employeeId: e.id, terminalId, type: "CLOCK_OUT", idempotencyKey: randomUUID(), photo: { data: jpeg, mime: "image/jpeg" }, testNow: berlinToInstant("2026-03-02", "20:00"), breakTaken: true });
    const photo = await prisma.clockEventPhoto.findUniqueOrThrow({ where: { clockEventId: a.eventId } });
    await prisma.absence.create({ data: { employeeId: e.id, type: "SICK", startDate: dbDate("2026-03-10"), endDate: dbDate("2026-03-10"), createdById: ADMIN, days: { create: { date: dbDate("2026-03-10"), creditedMinutes: 480, vacationDayValue: 0, basis: "CONTRACT_DAILY_AVG" } }, sickLeave: { create: {} } } });
    const auditBefore = await prisma.auditLog.count();

    expect((await eraseEmployee(e.id, ADMIN, "2028-12-31")).error).toMatch(/01\.01\.2029/);
    expect(await prisma.employee.count({ where: { id: e.id } })).toBe(1);

    const r = await eraseEmployee(e.id, ADMIN, "2029-01-01");
    expect(r.ok).toMatch(/endgültig gelöscht/);
    expect(await prisma.employee.count({ where: { id: e.id } })).toBe(0);
    expect(await prisma.timeClockEvent.count({ where: { employeeId: e.id } })).toBe(0);
    expect(await prisma.workSession.count({ where: { employeeId: e.id } })).toBe(0);
    expect(await prisma.absence.count({ where: { employeeId: e.id } })).toBe(0);
    await expect(blobStore.get(photo.storageKey)).rejects.toThrow();
    // Protokoll unverändert, plus ein Eintrag ohne Namen
    expect(await prisma.auditLog.count()).toBe(auditBefore + 1);
    const last = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(last.action).toBe("EMPLOYEE_ERASED");
    expect(JSON.stringify(last.after)).not.toMatch(/Lösch/);
  });
  it("Rohbuchungen bleiben ohne Löschfreigabe unveränderlich", async () => {
    const ev = await prisma.timeClockEvent.findFirst();
    if (ev) await expect(prisma.timeClockEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
  });
});

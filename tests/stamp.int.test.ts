// Integrationstests gegen eine echte PostgreSQL-Testdatenbank (TEST_DATABASE_URL).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { stamp } from "../lib/stamp";
import { decryptPhoto, hashSecret } from "../lib/crypto";
import { blobStore } from "../lib/storage";
import { berlinToInstant, dbDate } from "../lib/time";

const DAY = "2026-11-09";
const t = (hm: string, d = DAY) => berlinToInstant(d, hm);
let terminalId = "";
let deptId = "";

async function newEmployee(name: string) {
  const e = await prisma.employee.create({
    data: {
      personnelNumber: `T-${randomUUID().slice(0, 8)}`, firstName: name, lastName: "Test", displayName: name, employmentType: "FESTANGESTELLT",
      primaryDeptId: deptId, entryDate: dbDate("2026-01-01"), credential: { create: { pinHash: await hashSecret("482915"), mustSetPin: false } },
    },
  });
  const sched = await prisma.workSchedule.create({ data: { periodStart: dbDate(DAY), periodEnd: dbDate(DAY), status: "PUBLISHED" } });
  await prisma.scheduledShift.create({ data: { scheduleId: sched.id, employeeId: e.id, departmentId: deptId, workDate: dbDate(DAY), startAt: t("13:30"), endAt: t("22:00"), plannedBreakMinutes: 30 } });
  return e;
}
const fakeJpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4000, 1)]);
const go = (employeeId: string, type: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END", at: Date, extra: object = {}) =>
  stamp({ employeeId, terminalId, type, idempotencyKey: randomUUID(), photo: { data: fakeJpeg(), mime: "image/jpeg" }, testNow: at, ...extra });

beforeAll(async () => {
  const d = await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } });
  deptId = d.id;
  terminalId = (await prisma.terminalDevice.create({ data: { name: "Test", tokenHash: randomUUID() } })).id;
  await prisma.systemSetting.upsert({ where: { key: "photo.enabled" }, update: { value: true }, create: { key: "photo.enabled", value: true } });
  if (!(await prisma.dataProtectionApproval.findFirst({ where: { status: "APPROVED" } }))) {
    await prisma.dataProtectionApproval.create({ data: { feature: "PHOTO_CAPTURE", status: "APPROVED", purpose: "Test", legalBasis: "Test", retentionDays: 30, approvedAt: new Date() } });
  }
});

describe("Stempeln mit Datenbank", () => {
  it("1+5+6: pünktlich ein- und ausstempeln, je ein eigenes verschlüsseltes Foto, Pause bestätigt", async () => {
    const e = await newEmployee("Daniel");
    const a = await go(e.id, "CLOCK_IN", t("13:30"));
    const b = await go(e.id, "CLOCK_OUT", t("22:00"), { breakTaken: true });
    const photos = await prisma.clockEventPhoto.findMany({ where: { clockEventId: { in: [a.eventId, b.eventId] } } });
    expect(photos).toHaveLength(2);
    expect(photos[0].storageKey).not.toBe(photos[1].storageKey);
    const raw = await blobStore.get(photos[0].storageKey);
    expect(raw.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false); // verschlüsselt abgelegt
    expect(decryptPhoto(raw, Buffer.from(photos[0].iv), Buffer.from(photos[0].authTag)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect(s.status).toBe("CLOSED");
    expect(s.breakConfirmation).toBe("YES");
    expect(s.workedMinutes).toBe(480);
    expect(s.payableMinutes).toBe(480);
  });

  it("2: 15 Min. zu früh → vergütet ab 13:30, Stempelzeit 13:15 bleibt gespeichert", async () => {
    const e = await newEmployee("Früh");
    const a = await go(e.id, "CLOCK_IN", t("13:15"));
    await go(e.id, "CLOCK_OUT", t("22:00"), { breakTaken: true });
    const ev = await prisma.timeClockEvent.findUniqueOrThrow({ where: { id: a.eventId } });
    expect(ev.effectiveAt.getTime()).toBe(t("13:15").getTime());
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect(s.earlyArrivalMinutes).toBe(15);
    expect(s.payableMinutes).toBe(480);
  });

  it("3: 30 Min. zu spät → Prüfhinweis, kein Vorwurf", async () => {
    const e = await newEmployee("Spät");
    await go(e.id, "CLOCK_IN", t("14:00"));
    const f = await prisma.complianceFinding.findFirstOrThrow({ where: { employeeId: e.id, code: "LATE_START" } });
    expect(f.message).toContain("30 Min.");
  });

  it("4: 45 Min. nach Dienstende → zählt voll, Hinweis", async () => {
    const e = await newEmployee("Lang");
    await go(e.id, "CLOCK_IN", t("13:30"));
    await go(e.id, "CLOCK_OUT", t("22:45"), { breakTaken: true });
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect(s.overrunMinutes).toBe(45);
    expect(s.payableMinutes).toBe(525); // 9:15 Anwesenheit – 30 Min. Pause
    expect(await prisma.complianceFinding.count({ where: { employeeId: e.id, code: "LATE_END" } })).toBe(1);
  });

  it("7/31: Kamera fällt aus → Buchung trotzdem gespeichert, als technische Ausnahme markiert", async () => {
    const e = await newEmployee("Kamera");
    const r = await stamp({ employeeId: e.id, terminalId, type: "CLOCK_IN", idempotencyKey: randomUUID(), photo: null, photoMissingReason: "Kamerazugriff nicht erlaubt", testNow: t("13:30") });
    const ev = await prisma.timeClockEvent.findUniqueOrThrow({ where: { id: r.eventId } });
    expect(ev.photoStatus).toBe("MISSING_TECHNICAL");
    expect(await prisma.complianceFinding.count({ where: { employeeId: e.id, code: "PHOTO_MISSING" } })).toBe(1);
  });

  it("10: Pause nicht genommen → nichts abgezogen, Hinweis zur Klärung", async () => {
    const e = await newEmployee("OhnePause");
    await go(e.id, "CLOCK_IN", t("13:30"));
    await go(e.id, "CLOCK_OUT", t("22:00"), { breakTaken: false });
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect(s.breakConfirmation).toBe("NO");
    expect(s.workedMinutes).toBe(510);
    expect(await prisma.complianceFinding.count({ where: { employeeId: e.id, code: "BREAK_MISSING" } })).toBe(1);
  });

  it("Pause gestempelt: 40 Min. Pause werden exakt abgezogen", async () => {
    const e = await newEmployee("Pause");
    await go(e.id, "CLOCK_IN", t("13:30"));
    await go(e.id, "BREAK_START", t("17:00"));
    await go(e.id, "BREAK_END", t("17:40"));
    await go(e.id, "CLOCK_OUT", t("22:00"));
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect(s.breakMinutes).toBe(40);
    expect(s.workedMinutes).toBe(470);
  });

  it("Doppelbuchung: gleicher Schlüssel bucht nur einmal, zweites Einstempeln wird abgelehnt", async () => {
    const e = await newEmployee("Doppelt");
    const key = randomUUID();
    const a = await stamp({ employeeId: e.id, terminalId, type: "CLOCK_IN", idempotencyKey: key, photo: { data: fakeJpeg(), mime: "image/jpeg" }, testNow: t("13:30") });
    const b = await stamp({ employeeId: e.id, terminalId, type: "CLOCK_IN", idempotencyKey: key, photo: { data: fakeJpeg(), mime: "image/jpeg" }, testNow: t("13:30") });
    expect(b.duplicate).toBe(true);
    expect(b.eventId).toBe(a.eventId);
    await expect(go(e.id, "CLOCK_IN", t("13:31"))).rejects.toThrow("bereits eingestempelt");
    expect(await prisma.timeClockEvent.count({ where: { employeeId: e.id } })).toBe(1);
  });

  it("33: Dienst über Mitternacht", async () => {
    const e = await newEmployee("Nacht");
    await go(e.id, "CLOCK_IN", t("18:00"));
    await go(e.id, "CLOCK_OUT", t("02:00", "2026-11-10"), { breakTaken: true });
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect(s.workDate.toISOString().slice(0, 10)).toBe(DAY);
    expect(s.workedMinutes).toBe(450);
  });

  it("30: Rohbuchungen lassen sich auch direkt in der Datenbank nicht ändern oder löschen", async () => {
    const e = await newEmployee("Manipulation");
    const a = await go(e.id, "CLOCK_IN", t("13:30"));
    await expect(prisma.timeClockEvent.update({ where: { id: a.eventId }, data: { effectiveAt: t("12:00") } })).rejects.toThrow();
    await expect(prisma.timeClockEvent.delete({ where: { id: a.eventId } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
  });
});

describe("Änderungsprotokoll", () => {
  it("Hash-Kette ist lückenlos prüfbar", async () => {
    const { verifyAuditChain } = await import("../lib/audit");
    const e = await newEmployee("Kette");
    await go(e.id, "CLOCK_IN", t("13:30"));
    const first = await prisma.auditLog.findFirstOrThrow({ where: { employeeId: e.id }, orderBy: { id: "asc" } });
    await go(e.id, "CLOCK_OUT", t("22:00"), { breakTaken: true });
    const r = await verifyAuditChain(prisma, first.id);
    expect(r.ok).toBe(true);
    expect(r.checked).toBeGreaterThanOrEqual(2);
  });
});

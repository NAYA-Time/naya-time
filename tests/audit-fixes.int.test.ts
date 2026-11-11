// Korrekturen aus dem Systemaudit vom 10.11.2026 gegen die Testdatenbank (C1, C4, C7, C8, D1, D7).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { markStaleSessions, stamp } from "../lib/stamp";
import { correctSession } from "../lib/corrections";
import { closeEmployeeMonth } from "../lib/closing";
import { cancelPayrollPeriod, settlePayrollPeriod } from "../lib/payroll";
import { offlinePublicKey, processOfflineBatch, type OfflineItem } from "../lib/offline";
import { hashSecret } from "../lib/crypto";
import { berlinToInstant, dbDate } from "../lib/time";

let terminalId = "", deptId = "";
const ADMIN = randomUUID();
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4000, 1)]);
const go = (employeeId: string, type: "CLOCK_IN" | "CLOCK_OUT", at: Date, extra: object = {}) =>
  stamp({ employeeId, terminalId, type, idempotencyKey: randomUUID(), photo: null, photoMissingReason: "Test", testNow: at, breakTaken: true, ...extra });
const newEmp = async () => prisma.employee.create({ data: { personnelNumber: `A-${randomUUID().slice(0, 8)}`, firstName: "Audit", lastName: "Test", displayName: "Audit T.", employmentType: "FESTANGESTELLT", primaryDeptId: deptId, entryDate: dbDate("2026-01-01"),
  contracts: { create: { validFrom: dbDate("2026-01-01"), payModel: "SALARIED", weeklyMinutes: 2400 } }, account: { create: { openedAt: dbDate("2026-01-01") } },
  credential: { create: { pinHash: await hashSecret("482915"), mustSetPin: false } } } });
const files = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);

beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } })).id;
  terminalId = (await prisma.terminalDevice.create({ data: { name: "Audit-Test", tokenHash: randomUUID() } })).id;
});

describe("C1: früher Beginn genehmigen", () => {
  it("ohne Genehmigung ab Dienstbeginn, mit Haken ab Stempelzeit, Haken raus wieder ab Dienstbeginn – alles protokolliert", async () => {
    const e = await newEmp();
    const day = "2026-11-17";
    const sched = await prisma.workSchedule.create({ data: { periodStart: dbDate(day), periodEnd: dbDate(day), status: "PUBLISHED" } });
    await prisma.scheduledShift.create({ data: { scheduleId: sched.id, employeeId: e.id, departmentId: deptId, workDate: dbDate(day), startAt: berlinToInstant(day, "15:00"), endAt: berlinToInstant(day, "23:00"), plannedBreakMinutes: 0 } });
    await go(e.id, "CLOCK_IN", berlinToInstant(day, "14:00"));
    await go(e.id, "CLOCK_OUT", berlinToInstant(day, "20:00"));
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect([s.payableMinutes, s.earlyArrivalMinutes]).toEqual([300, 60]);
    expect((await correctSession(ADMIN, s.id, { earlyStart: true, reason: "Vorbereitung Bankett, abgesprochen" })).ok).toMatch(/6:00/);
    expect(await prisma.workSession.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ payableMinutes: 360, earlyStartApproved: true });
    expect((await correctSession(ADMIN, s.id, { earlyStart: true, reason: "nochmal dasselbe" })).error).toMatch(/Keine Änderung/);
    expect((await correctSession(ADMIN, s.id, { earlyStart: false, reason: "Irrtum, war nicht abgesprochen" })).ok).toMatch(/5:00/);
    expect(await prisma.timeCorrection.count({ where: { workSessionId: s.id, field: "PAYABLE_START" } })).toBe(2);
  });
});

describe("C4: vergessenes Ausstempeln ohne erneute Anmeldung", () => {
  it("die stündliche Prüfung markiert alle zu lange offenen Schichten", async () => {
    const e = await newEmp();
    await go(e.id, "CLOCK_IN", berlinToInstant("2026-11-18", "16:00"));
    const status = async () => (await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } })).status;
    await prisma.$transaction((tx) => markStaleSessions(tx, null, berlinToInstant("2026-11-18", "23:00")));
    expect(await status()).toBe("OPEN"); // nach 7 Std. noch nicht
    expect(await prisma.$transaction((tx) => markStaleSessions(tx, null, berlinToInstant("2026-11-19", "07:00")))).toBeGreaterThanOrEqual(1);
    expect((await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } })).status).toBe("MISSING_CLOCK_OUT");
  });
});

describe("C8: abgelehnte Buchung hinterlässt kein Foto", () => {
  it("zweites Einstempeln mit Foto wird abgelehnt und das Foto wieder entfernt", async () => {
    const e = await newEmp();
    await prisma.systemSetting.upsert({ where: { key: "photo.enabled" }, update: { value: true }, create: { key: "photo.enabled", value: true } });
    const at = berlinToInstant("2026-11-19", "16:00");
    await go(e.id, "CLOCK_IN", at, { photo: { data: jpeg(), mime: "image/jpeg" } });
    const dir = path.resolve(process.env.STORAGE_DIR!, "photos");
    const before = files(dir).length;
    await expect(go(e.id, "CLOCK_IN", new Date(at.getTime() + 60000), { photo: { data: jpeg(), mime: "image/jpeg" } })).rejects.toThrow();
    expect(files(dir).length).toBe(before);
  });
});

describe("C7: PIN-Sperre gilt auch offline", () => {
  it("nach 5 falschen PINs im Stapel wird auch der richtige PIN abgelehnt, solange gesperrt ist", async () => {
    const e = await newEmp();
    const spki = await offlinePublicKey(prisma);
    const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(b)).toString("base64");
    const seal = async (secret: object) => {
      const pub = await crypto.subtle.importKey("spki", Buffer.from(spki, "base64"), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
      const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(secret)));
      return { wrappedKey: b64(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, await crypto.subtle.exportKey("raw", aes))), iv: b64(iv), data: b64(data) };
    };
    const now = new Date();
    const base = now.getTime() - 3600_000;
    const mk = async (i: number, pin: string): Promise<OfflineItem> => ({ id: randomUUID(), sealed: await seal({ employeeId: e.id, pin, type: "CLOCK_IN", breakTaken: null }),
      evidence: { recordedDeviceAt: base + i * 1000, syncServerAt: base - 60000, syncDeviceAt: base - 60000, syncPerf: 0, recordedPerf: 60000 + i * 1000, samePage: true } });
    const items = [...(await Promise.all([0, 1, 2, 3, 4].map((i) => mk(i, "000000")))), await mk(5, "482915")];
    const res = await processOfflineBatch(terminalId, items, prisma, now);
    expect(res.map((r) => r.status)).toEqual(Array(6).fill("REJECTED"));
    expect(res[5].message).toMatch(/gesperrt/);
    expect(await prisma.workSession.count({ where: { employeeId: e.id } })).toBe(0);
  });
});

describe("D1: Festschreiben und Stornieren gleichzeitig", () => {
  it("genau eine der beiden Aktionen gewinnt", async () => {
    const p = await prisma.payrollPeriod.create({ data: { cutoffDate: dbDate("2026-10-31"), label: "Audit-Test", createdById: ADMIN } });
    const [a, b] = await Promise.all([settlePayrollPeriod(ADMIN, p.id), cancelPayrollPeriod(ADMIN, p.id)]);
    expect([a, b].filter((r) => "ok" in r && r.ok).length).toBe(1);
    await prisma.payrollPeriod.update({ where: { id: p.id }, data: { status: "CANCELLED" } }).catch(() => {});
  });
});

describe("D7: erster Monatsabschluss", () => {
  it("überspringt keinen früheren Monat mit Buchungen", async () => {
    const e = await newEmp();
    await go(e.id, "CLOCK_IN", berlinToInstant("2026-08-11", "10:00"));
    await go(e.id, "CLOCK_OUT", berlinToInstant("2026-08-11", "16:00"));
    const r = await closeEmployeeMonth(ADMIN, e.id, "2026-10");
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/August 2026/) });
    expect((await closeEmployeeMonth(ADMIN, e.id, "2026-08")).ok).toBe(true);
  });
});

// Vergessenes Ausstempeln und Korrekturen gegen die Testdatenbank.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { stamp } from "../lib/stamp";
import { addManualSession, correctSession } from "../lib/corrections";
import { hashSecret } from "../lib/crypto";
import { berlinToInstant, dbDate } from "../lib/time";

let terminalId = "", deptId = "";
const ADMIN = randomUUID();
const go = (employeeId: string, type: "CLOCK_IN" | "CLOCK_OUT", at: Date) => stamp({ employeeId, terminalId, type, idempotencyKey: randomUUID(), photo: null, photoMissingReason: "Test", testNow: at, breakTaken: true });

beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } })).id;
  terminalId = (await prisma.terminalDevice.create({ data: { name: "Korrektur-Test", tokenHash: randomUUID() } })).id;
});
const newEmp = async () => prisma.employee.create({ data: { personnelNumber: `K-${randomUUID().slice(0, 8)}`, firstName: "Korr", lastName: "Test", displayName: "Korr T.", employmentType: "FESTANGESTELLT", primaryDeptId: deptId, entryDate: dbDate("2026-01-01"), credential: { create: { pinHash: await hashSecret("482915"), mustSetPin: false } } } });

describe("Vergessenes Ausstempeln und Korrektur", () => {
  it("nach 14 Std. offen → 'Ausstempeln fehlt', neues Einstempeln möglich; Ende nachtragen schließt die Schicht, Original bleibt", async () => {
    const e = await newEmp();
    await go(e.id, "CLOCK_IN", berlinToInstant("2026-11-02", "16:00"));
    // nächster Tag: Mitarbeiter stempelt einfach wieder ein
    await go(e.id, "CLOCK_IN", berlinToInstant("2026-11-03", "16:05"));
    const [first, second] = await prisma.workSession.findMany({ where: { employeeId: e.id }, orderBy: { workDate: "asc" }, include: { clockOutEvent: true } });
    expect([first.status, first.payableMinutes, second.status]).toEqual(["MISSING_CLOCK_OUT", 0, "OPEN"]);
    expect(await prisma.complianceFinding.count({ where: { refId: first.id, code: "MISSING_CLOCK_OUT", status: "OPEN" } })).toBe(1);

    expect(await correctSession(ADMIN, first.id, { clockOut: "23:30", reason: "kurz" })).toMatchObject({ error: expect.stringMatching(/Grund/) });
    const r = await correctSession(ADMIN, first.id, { clockOut: "23:30", breakMinutes: 30, reason: "Ausstempeln vergessen, laut Dienstplan" });
    expect(r.ok).toMatch(/7:00/); // 16:00–23:30 minus 30 Min. Pause
    const after = await prisma.workSession.findUniqueOrThrow({ where: { id: first.id }, include: { clockOutEvent: true } });
    expect([after.status, after.payableMinutes, after.clockOutEvent]).toEqual(["CLOSED", 420, null]); // keine erfundene Stempelung
    expect(await prisma.complianceFinding.count({ where: { refId: first.id, code: "MISSING_CLOCK_OUT", status: "OPEN" } })).toBe(0);
    expect(await prisma.timeCorrection.count({ where: { workSessionId: first.id } })).toBe(2);
  });

  it("zweite Korrektur desselben Feldes ersetzt die erste (Kette), Ende über Mitternacht, Fehlbuchung", async () => {
    const e = await newEmp();
    await go(e.id, "CLOCK_IN", berlinToInstant("2026-11-05", "18:00"));
    await go(e.id, "CLOCK_OUT", berlinToInstant("2026-11-05", "23:00"));
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    await correctSession(ADMIN, s.id, { clockOut: "23:45", reason: "Abrechnung Kasse gedauert" });
    const r = await correctSession(ADMIN, s.id, { clockOut: "00:30", reason: "Nachtrag: bis Schichtende geblieben" });
    expect(r.ok).toMatch(/6:30/); // 18:00–00:30; keine Pause dokumentiert → nichts abgezogen (Regel: nur gestempelte/bestätigte Pausen)
    const chain = await prisma.timeCorrection.findMany({ where: { workSessionId: s.id, field: "CLOCK_OUT" }, orderBy: { createdAt: "asc" } });
    expect(chain[1].supersedesId).toBe(chain[0].id);
    expect((await correctSession(ADMIN, s.id, { voidSession: true, reason: "Doppelt erfasst, Fehlbuchung" })).ok).toMatch(/0:00/);
    await expect(prisma.timeCorrection.update({ where: { id: chain[0].id }, data: { reason: "x" } })).rejects.toThrow(); // unveränderlich
  });

  it("komplett vergessene Schicht nachtragen: ohne Rohbuchung, mit Name/Grund, Überschneidung abgelehnt, danach korrigierbar", async () => {
    const e = await newEmp();
    await go(e.id, "CLOCK_IN", berlinToInstant("2026-11-05", "10:00"));
    await go(e.id, "CLOCK_OUT", berlinToInstant("2026-11-05", "14:00"));
    const base = { employeeId: e.id, date: "2026-11-05", breakMinutes: 30, reason: "Stempeln vergessen, Abendschicht" };
    expect(await addManualSession(ADMIN, { ...base, clockIn: "13:00", clockOut: "20:00" })).toMatchObject({ error: expect.stringMatching(/Überschneidet/) });
    const r = await addManualSession(ADMIN, { ...base, clockIn: "17:00", clockOut: "01:00" }); // über Mitternacht
    expect(r.ok).toMatch(/7:30/);
    const s = await prisma.workSession.findUniqueOrThrow({ where: { id: r.sessionId! }, include: { corrections: true } });
    expect([s.clockInEventId, s.status, s.payableMinutes]).toEqual([null, "CLOSED", 450]);
    expect(s.corrections.map((c) => c.field).sort()).toEqual(["ADD_SESSION", "BREAK_MINUTES", "CLOCK_IN", "CLOCK_OUT"]);
    expect(s.corrections.every((c) => c.createdById === ADMIN && c.reason === base.reason)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "SESSION_ADDED", entityId: s.id } })).toBe(1);
    const c = await correctSession(ADMIN, s.id, { clockOut: "00:30", reason: "Ende war früher" });
    expect(c.ok).toMatch(/7:00/);
  });
});

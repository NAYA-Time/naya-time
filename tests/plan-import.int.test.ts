// Dienstplan-Foto speichern gegen die Testdatenbank: Standarddienst, Überspringen, Ersetzen.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { savePlanImport } from "../lib/plan-import";
import { berlinTime, dbDate } from "../lib/time";

const ADMIN = randomUUID();
const MONDAY = "2031-03-03"; // eigene Woche, stört keine anderen Tests
let emp = "";
const shifts = () => prisma.scheduledShift.findMany({ where: { employeeId: emp, deletedAt: null }, orderBy: { startAt: "asc" } });
const cells = (start: string, end: string | null = null) => [{ date: MONDAY, kind: "WORK" as const, start, end }, { date: "2031-03-04", kind: "VACATION" as const, start: null, end: null }];

beforeAll(async () => {
  const dept = await prisma.department.upsert({ where: { key: "KITCHEN" }, update: {}, create: { key: "KITCHEN", name: "Küche", kind: "MAIN" } });
  emp = (await prisma.employee.create({ data: { personnelNumber: `P-${randomUUID().slice(0, 8)}`, firstName: "Azis", lastName: "Test", displayName: "Azis T.", employmentType: "FESTANGESTELLT", primaryDeptId: dept.id, entryDate: dbDate("2030-01-01") } })).id;
});

describe("Dienstplan-Foto speichern", () => {
  it("nur Beginn → Standarddienst 8:30 inkl. 30 Min. Pause; Urlaub wird nur gemeldet", async () => {
    const r = await savePlanImport(ADMIN, { monday: MONDAY, replace: false, rows: [{ employeeId: emp, cells: cells("13:30") }] });
    expect(r.ok).toContain("1 Dienste übernommen");
    expect(r.ok).toContain("Abwesenheiten");
    const [s] = await shifts();
    expect(berlinTime(s.startAt!)).toBe("13:30");
    expect(berlinTime(s.endAt!)).toBe("22:00");
    expect(s.plannedBreakMinutes).toBe(30);
    expect(await prisma.absence.count({ where: { employeeId: emp } })).toBe(0);
  });
  it("zweiter Import überspringt den Tag, mit Ersetzen wird getauscht", async () => {
    const r = await savePlanImport(ADMIN, { monday: MONDAY, replace: false, rows: [{ employeeId: emp, cells: cells("15:00") }] });
    expect(r.ok).toContain("1 übersprungen");
    expect((await shifts()).map((s) => berlinTime(s.startAt!))).toEqual(["13:30"]);
    const r2 = await savePlanImport(ADMIN, { monday: MONDAY, replace: true, rows: [{ employeeId: emp, cells: cells("15:00", "01:00") }] });
    expect(r2.ok).toContain("1 vorhandene ersetzt");
    const now = await shifts();
    expect(now).toHaveLength(1);
    expect(berlinTime(now[0].endAt!)).toBe("01:00"); // über Mitternacht
    expect(now[0].endAt!.getTime() - now[0].startAt!.getTime()).toBe(10 * 3600000);
  });
  it("falscher Montag oder nichts ausgewählt → Fehler", async () => {
    expect((await savePlanImport(ADMIN, { monday: "2031-03-04", replace: false, rows: [] })).error).toBeTruthy();
    expect((await savePlanImport(ADMIN, { monday: MONDAY, replace: false, rows: [{ employeeId: null, cells: cells("13:30") }] })).error).toContain("kein Dienst");
  });
});

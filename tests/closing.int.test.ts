// Monatsabschluss gegen die echte Testdatenbank: Kontobuchungen, Reihenfolge, Korrektur als neue Version.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { closeEmployeeMonth, correctEmployeeClosing } from "../lib/closing";
import { dbDate } from "../lib/time";

const ADMIN = randomUUID();
let deptId = "";
const H = 60;

async function newEmployee() {
  return prisma.employee.create({
    data: {
      personnelNumber: `M-${randomUUID().slice(0, 8)}`, firstName: "Monat", lastName: "Test", displayName: "Monat T.", employmentType: "FESTANGESTELLT",
      primaryDeptId: deptId, entryDate: dbDate("2026-01-01"),
      contracts: { create: { validFrom: dbDate("2026-01-01"), payModel: "SALARIED", weeklyMinutes: 2550 } },
      overtimeRules: { create: { validFrom: dbDate("2026-01-01"), includedMinutesPerMonth: 10 * H } },
      account: { create: { openedAt: dbDate("2026-01-01") } },
    },
  });
}
// Anrechnung über einen Abwesenheitstag (spart hunderte Stempelungen; die Rechenregeln selbst sind in month.test.ts geprüft)
const credit = (employeeId: string, day: string, minutes: number) =>
  prisma.absence.create({ data: { employeeId, type: "SPECIAL_LEAVE", startDate: dbDate(day), endDate: dbDate(day), status: "CONFIRMED", createdById: ADMIN, days: { create: { date: dbDate(day), creditedMinutes: minutes, vacationDayValue: 0, basis: "CONTRACT_DAILY_AVG" } } } });
const balance = async (employeeId: string) => (await prisma.workingTimeTransaction.aggregate({ _sum: { minutes: true }, where: { account: { employeeId } } }))._sum.minutes ?? 0;

beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } })).id;
});

describe("Monatsabschluss mit Datenbank", () => {
  it("Mehrarbeit, dann Defizit: Konto und 'aus Vormonaten' stimmen, Reihenfolge wird erzwungen, Korrektur bucht nur die Differenz", async () => {
    const e = await newEmployee();
    await credit(e.id, "2026-09-15", 184 * H + 10 + 16 * H); // 16 Std. über Soll
    const sep = await closeEmployeeMonth(ADMIN, e.id, "2026-09");
    expect(sep.ok && [sep.r.included, sep.r.accountChange, sep.r.balanceAfter]).toEqual([600, 360, 360]);
    expect(await balance(e.id)).toBe(360);

    // doppelt abschließen und früheren Monat nachträglich abschließen geht nicht
    expect(await closeEmployeeMonth(ADMIN, e.id, "2026-09")).toMatchObject({ ok: false, error: expect.stringMatching(/bereits abgeschlossen/) });
    expect(await closeEmployeeMonth(ADMIN, e.id, "2026-08")).toMatchObject({ ok: false, error: expect.stringMatching(/späterer Monat/) });

    await credit(e.id, "2026-10-15", 180 * H + 10); // 4 Std. zu wenig
    const oct = await closeEmployeeMonth(ADMIN, e.id, "2026-10");
    expect(oct.ok && [oct.r.balanceBefore, oct.r.decision, oct.r.accountChange, oct.r.balanceAfter]).toEqual([360, "AUTO_BOOKED", -240, 120]);
    expect(await balance(e.id)).toBe(120);

    // Nachtrag im Oktober → Korrektur: neue Version, alte bleibt als ersetzt erhalten, Konto +4 Std.
    await credit(e.id, "2026-10-20", 4 * H);
    const active = await prisma.monthlyTimeClosing.findFirstOrThrow({ where: { employeeId: e.id, month: dbDate("2026-10-01"), status: "CLOSED" } });
    expect(await correctEmployeeClosing({ id: ADMIN }, active.id, "kurz")).toMatchObject({ error: expect.stringMatching(/Grund/) });
    const res = await correctEmployeeClosing({ id: ADMIN }, active.id, "Sonderurlaub nachgetragen");
    expect(res.ok).toMatch(/Version 2/);
    const versions = await prisma.monthlyTimeClosing.findMany({ where: { employeeId: e.id, month: dbDate("2026-10-01") }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.status, v.accountChangeMinutes])).toEqual([[1, "SUPERSEDED", -240], [2, "CLOSED", 0]]);
    expect(await balance(e.id)).toBe(360);
    // ein ersetzter Stand kann nicht noch einmal korrigiert werden
    expect(await correctEmployeeClosing({ id: ADMIN }, active.id, "noch einmal")).toMatchObject({ error: expect.stringMatching(/ersetzt/) });
  });

  it("Monate werden lückenlos abgeschlossen", async () => {
    const e = await newEmployee();
    await credit(e.id, "2026-08-10", 184 * H + 10);
    expect((await closeEmployeeMonth(ADMIN, e.id, "2026-08")).ok).toBe(true);
    expect(await closeEmployeeMonth(ADMIN, e.id, "2026-10")).toMatchObject({ ok: false, error: expect.stringMatching(/zuerst September/) });
  });

  it("laufender Monat und offene Schichten sperren den Abschluss", async () => {
    const e = await newEmployee();
    expect(await closeEmployeeMonth(ADMIN, e.id, "2099-01")).toMatchObject({ ok: false, error: expect.stringMatching(/nicht vorbei/) });
  });
});

// Handy-Portal: Einladung, Anmeldung, Sperre, nur freigegebene Inhalte, Urlaubsantrag → Genehmigung legt Urlaub an.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { acceptInvite, createInvite, portalEmployee, portalLogin, portalOverview, requestVacation } from "../lib/portal";
import { createAbsenceCore } from "../lib/absences";
import { berlinToInstant, dbDate } from "../lib/time";

const ADMIN = "00000000-0000-4000-8000-000000000001";
let emp = { id: "", personnelNumber: "" };

beforeAll(async () => {
  const dept = await prisma.department.upsert({ where: { key: "SERVICE" }, update: {}, create: { key: "SERVICE", name: "Service", kind: "MAIN" } });
  emp = await prisma.employee.create({ data: { personnelNumber: `H-${randomUUID().slice(0, 6)}`, firstName: "Betty", lastName: "Handy", displayName: "Betty H.", employmentType: "FESTANGESTELLT", primaryDeptId: dept.id, entryDate: dbDate("2026-01-01"),
    credential: { create: { mustSetPin: false, portalEnabled: true } }, contracts: { create: { validFrom: dbDate("2026-01-01"), payModel: "SALARIED", weeklyMinutes: 2400, vacationDaysPerYear: 26 } } } });
});

describe("Handy-Portal", () => {
  let token = "";
  it("Einladung: Passwort setzen, Link nur einmal", async () => {
    const inv = await createInvite(emp.id, ADMIN);
    expect((await acceptInvite(inv, "123456789012", null)).error).toMatch(/Ziffern/);
    const r = await acceptInvite(inv, "sommer-im-naya", null);
    expect(r.session?.token).toBeTruthy();
    token = r.session!.token;
    expect((await acceptInvite(inv, "sommer-im-naya", null)).error).toMatch(/ungültig/);
  });
  it("Anmeldung mit Personalnummer + Passwort", async () => {
    expect((await portalLogin(emp.personnelNumber, "falsch-falsch", null)).error).toBeTruthy();
    expect((await portalLogin(emp.personnelNumber, "sommer-im-naya", null)).session).toBeTruthy();
  });
  it("ohne Häkchen nichts sichtbar; Sperre wirkt sofort", async () => {
    const me = await portalEmployee(token);
    expect(me && Object.values(me.show).some(Boolean)).toBe(false);
    const o = await portalOverview(emp.id, me!.show);
    expect([o.plan, o.week, o.month, o.balance, o.vacation]).toEqual([null, null, null, null, null]);
    await prisma.employeeCredential.update({ where: { employeeId: emp.id }, data: { portalEnabled: false } });
    expect(await portalEmployee(token)).toBeNull();
    await prisma.employeeCredential.update({ where: { employeeId: emp.id }, data: { portalEnabled: true } });
  });
  it("Stunden nur laufende Woche: Vorwoche zählt nicht", async () => {
    await prisma.portalVisibility.create({ data: { employeeId: emp.id, schedule: false, weeklyHours: true } });
    for (const d of ["2026-11-06", "2026-11-09", "2026-11-10"]) {
      await prisma.workSession.create({ data: { employeeId: emp.id, departmentId: (await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } })).primaryDeptId, workDate: dbDate(d), status: "CLOSED", payableMinutes: 480, workedMinutes: 480, presenceMinutes: 510, breakMinutes: 30, effectiveStartAt: berlinToInstant(d, "12:00") } });
    }
    const me = await portalEmployee(token);
    const o = await portalOverview(emp.id, me!.show, berlinToInstant("2026-11-11", "10:00"));
    expect(o.week?.worked).toBe(960); // Mo 09.11. + Di 10.11., nicht Fr 06.11.
    expect(o.month).toBeNull();
  });
  it("Urlaubsantrag → Genehmigung legt Urlaub an", async () => {
    expect((await requestVacation(emp.id, "2026-11-01", "2026-11-02", "", "2026-11-09")).error).toMatch(/Zukunft/);
    expect((await requestVacation(emp.id, "2026-12-21", "2026-12-23", "Weihnachten", "2026-11-09")).ok).toBeTruthy();
    expect((await requestVacation(emp.id, "2026-12-22", "2026-12-22", "", "2026-11-09")).error).toMatch(/schon/);
    const r = await prisma.vacationRequest.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(await prisma.absence.count({ where: { employeeId: emp.id } })).toBe(0); // Antrag allein bucht nichts
    const a = await createAbsenceCore(ADMIN, { employeeId: emp.id, type: "VACATION", from: "2026-12-21", to: "2026-12-23" });
    expect(a.absenceId).toBeTruthy();
    expect(r.status).toBe("OPEN");
  });
});

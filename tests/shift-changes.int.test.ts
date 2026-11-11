// Geänderte Dienste werden je Mitarbeiter festgehalten (farbige Markierung am Terminal/Handy).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { savePlanImport } from "../lib/plan-import";
import { myPlan, unseenPlanChanges } from "../lib/terminal-session";
import { berlinToInstant, dbDate } from "../lib/time";

const ADMIN = randomUUID();
const MONDAY = "2031-04-07";
let emp = "";
const changes = () => prisma.shiftChange.findMany({ where: { employeeId: emp }, orderBy: { workDate: "asc" } });

beforeAll(async () => {
  const dept = await prisma.department.upsert({ where: { key: "SERVICE" }, update: {}, create: { key: "SERVICE", name: "Service", kind: "MAIN" } });
  emp = (await prisma.employee.create({ data: { personnelNumber: `C-${randomUUID().slice(0, 8)}`, firstName: "Levin", lastName: "Test", displayName: "Levin T.", employmentType: "FESTANGESTELLT", primaryDeptId: dept.id, entryDate: dbDate("2030-01-01") } })).id;
});

describe("Dienstplanänderungen", () => {
  it("erster Plan der Woche ist keine Änderung", async () => {
    await savePlanImport(ADMIN, { monday: MONDAY, replace: false, rows: [{ employeeId: emp, cells: [{ date: MONDAY, kind: "WORK", start: "15:00", end: "23:00" }, { date: "2031-04-08", kind: "WORK", start: "18:00", end: "23:00" }] }] });
    expect(await changes()).toHaveLength(0);
    await prisma.scheduledShift.updateMany({ where: { employeeId: emp }, data: { createdAt: new Date("2026-01-01T10:00:00Z") } });
  });
  it("neuer Plan: geänderte Zeit, gestrichener und neuer Dienst werden markiert", async () => {
    const r = await savePlanImport(ADMIN, { monday: MONDAY, replace: true, rows: [{ employeeId: emp, cells: [
      { date: MONDAY, kind: "WORK", start: "16:00", end: "23:00" },
      { date: "2031-04-08", kind: "OFF", start: null, end: null },
      { date: "2031-04-10", kind: "WORK", start: "18:00", end: "23:00" },
    ] }] });
    expect(r.ok).toContain("1 gestrichen");
    const c = await changes();
    expect(c.map((x) => [x.before, x.after])).toEqual([["15:00–23:00", "16:00–23:00"], ["18:00–23:00", null], [null, "18:00–23:00"]]);
  });
  it("Mitarbeiter sieht Hinweis einmal, Markierung am Tag bleibt", async () => {
    const now = berlinToInstant("2031-04-07", "12:00");
    const first = await unseenPlanChanges(emp, now);
    expect(first).toEqual(["Mo 07.04.: 16:00–23:00 – geändert, vorher 15:00–23:00", "Di 08.04.: gestrichen (war 18:00–23:00)", "Do 10.04.: 18:00–23:00 – neu"]);
    expect(await unseenPlanChanges(emp, now)).toEqual([]);
    const [week] = await myPlan(emp, now);
    expect(week.days.map((d) => d.change)).toEqual(["geändert, vorher 15:00–23:00", "gestrichen (war 18:00–23:00)", null, "neu", null, null, null]);
  });
  it("Zurückändern hebt eine ungesehene Änderung wieder auf", async () => {
    await savePlanImport(ADMIN, { monday: MONDAY, replace: true, rows: [{ employeeId: emp, cells: [{ date: "2031-04-11", kind: "WORK", start: "12:00", end: "20:00" }] }] });
    expect((await changes()).filter((x) => !x.seenAt)).toHaveLength(1);
    await savePlanImport(ADMIN, { monday: MONDAY, replace: true, rows: [{ employeeId: emp, cells: [{ date: "2031-04-11", kind: "OFF", start: null, end: null }] }] });
    expect((await changes()).filter((x) => !x.seenAt)).toHaveLength(0);
  });
});

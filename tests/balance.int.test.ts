// Laufender Kontostand bis gestern (Minus-Hinweis am Terminal, Plus/Minus-Übersicht)
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { runningBalance } from "../lib/month-data";
import { berlinToInstant, dbDate } from "../lib/time";

async function emp(payModel: "SALARIED" | "HOURLY") {
  const dept = await prisma.department.upsert({ where: { key: "SERVICE" }, update: {}, create: { key: "SERVICE", name: "Service", kind: "MAIN" } });
  return prisma.employee.create({ data: { personnelNumber: `B-${randomUUID().slice(0, 8)}`, firstName: "Bal", lastName: "Ance", displayName: "Bal A.", employmentType: "FESTANGESTELLT", primaryDeptId: dept.id, entryDate: dbDate("2031-01-01"), contracts: { create: { validFrom: dbDate("2031-01-01"), payModel, weeklyMinutes: 2400 } } } });
}

describe("Stand bis gestern", () => {
  it("ohne Arbeit: Soll anteilig bis gestern als Minus (10 von 31 Tagen bei 40 Std./Woche)", async () => {
    const e = await emp("SALARIED");
    expect(await runningBalance(prisma, e.id, "2031-01-11")).toBe(-Math.round((10400 * 10) / 31));
    expect(await runningBalance(prisma, e.id, "2031-01-01")).toBeNull(); // noch kein ganzer Tag
  });
  it("gestempelte Arbeit zählt, heute nicht", async () => {
    const e = await emp("SALARIED");
    for (const d of ["2031-01-01", "2031-01-02", "2031-01-03", "2031-01-04"]) {
      await prisma.workSession.create({ data: { employeeId: e.id, departmentId: e.primaryDeptId, workDate: dbDate(d), status: "CLOSED", payableMinutes: 600, workedMinutes: 600, presenceMinutes: 630, breakMinutes: 30, effectiveStartAt: berlinToInstant(d, "12:00") } });
    }
    const b = await runningBalance(prisma, e.id, "2031-01-04");
    const sessions = await prisma.workSession.count({ where: { employeeId: e.id } });
    expect(sessions).toBe(4); // der Dienst von heute (04.01.) zählt noch nicht mit
    expect(b).toBe(3 * 600 - Math.round((10400 * 3) / 31));
  });
  it("Aushilfe: kein Stundenkonto", async () => {
    const e = await emp("HOURLY");
    expect(await runningBalance(prisma, e.id, "2031-01-11")).toBeNull();
  });
});

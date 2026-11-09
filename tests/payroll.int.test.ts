// Aushilfenabrechnung gegen die Testdatenbank: Lauf, keine Doppelabrechnung, Storno, Festschreiben, Zahlungen.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { cancelPayrollPeriod, createPayrollPeriod, loadOpenPayroll, recordPayment, settlePayrollPeriod } from "../lib/payroll";
import { dbDate } from "../lib/time";

const ADMIN = randomUUID();
let deptId = "";

async function aushilfe() {
  return prisma.employee.create({
    data: {
      personnelNumber: `A-${randomUUID().slice(0, 8)}`, firstName: "Aus", lastName: "Hilfe", displayName: "Aus H.", employmentType: "MINIJOB",
      primaryDeptId: deptId, entryDate: dbDate("2026-01-01"),
      contracts: { create: { validFrom: dbDate("2026-01-01"), payModel: "HOURLY" } },
      wages: { create: { validFrom: dbDate("2026-01-01"), centsPerHour: 1500 } },
    },
  });
}
// Bezahlte Krankheit mit eingefrorenem Dienst als Quelle (die Rechenregeln für Schichten prüft payroll.test.ts)
const sick = (employeeId: string, day: string, minutes: number) =>
  prisma.absence.create({ data: { employeeId, type: "SICK", startDate: dbDate(day), endDate: dbDate(day), status: "CONFIRMED", createdById: ADMIN, days: { create: { date: dbDate(day), creditedMinutes: minutes, vacationDayValue: 0, basis: "SCHEDULE_SNAPSHOT" } } } });
const mine = async (employeeId: string, cutoff: string) => (await loadOpenPayroll(prisma, cutoff)).find((e) => e.employeeId === employeeId);

beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "SERVICE" }, update: {}, create: { key: "SERVICE", name: "Service", kind: "MAIN" } })).id;
  // vorbereitete Läufe aus früheren Testläufen stören die Regel "nur ein vorbereiteter Lauf"
  await prisma.payrollPeriod.updateMany({ where: { status: "PREPARED" }, data: { status: "CANCELLED" } });
});

describe("Aushilfenabrechnung mit Datenbank", () => {
  it("Lauf bis Stichtag, Übertrag, Storno macht Stunden wieder offen, Festschreiben verhindert Doppelabrechnung, Zahlungsstatus", async () => {
    const e = await aushilfe();
    await sick(e.id, "2026-10-28", 360); // vor dem Stichtagsmonat → Übertrag
    await sick(e.id, "2026-11-20", 300);
    await sick(e.id, "2026-11-27", 240); // nach Stichtag

    const before = await mine(e.id, "2026-11-25");
    expect([before?.minutes, before?.grossCents, before?.carryMinutes]).toEqual([660, 16500, 360]);

    const p1 = await createPayrollPeriod(ADMIN, "2026-11-25", "Test November");
    expect(p1.id).toBeTruthy();
    expect(await mine(e.id, "2026-11-25")).toBeUndefined(); // vorbereitet = reserviert
    expect(await createPayrollPeriod(ADMIN, "2026-11-25", "zweiter")).toMatchObject({ error: expect.stringMatching(/schon einen vorbereiteten/) });

    expect((await cancelPayrollPeriod(ADMIN, p1.id!)).ok).toBeTruthy();
    expect((await mine(e.id, "2026-11-25"))?.minutes).toBe(660); // wieder offen

    const p2 = await createPayrollPeriod(ADMIN, "2026-11-25", "Test November 2");
    const s = await prisma.payrollSettlement.findFirstOrThrow({ where: { periodId: p2.id, employeeId: e.id } });
    expect(await recordPayment(ADMIN, s.id, 1000, "2026-11-30", null)).toMatchObject({ error: expect.stringMatching(/festschreiben/) });
    expect((await settlePayrollPeriod(ADMIN, p2.id!)).ok).toBeTruthy();
    expect(await cancelPayrollPeriod(ADMIN, p2.id!)).toMatchObject({ error: expect.stringMatching(/Nur ein vorbereiteter/) });

    // nächster Lauf bis Monatsende: nur der 27.11.
    const next = await mine(e.id, "2026-11-30");
    expect([next?.minutes, next?.carryMinutes]).toEqual([240, 0]);

    expect(await recordPayment(ADMIN, s.id, 99999, "2026-11-30", null)).toMatchObject({ error: expect.stringMatching(/höher/) });
    expect((await recordPayment(ADMIN, s.id, 10000, "2026-11-30", "Bar")).ok).toBeTruthy();
    expect((await prisma.payrollSettlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PARTIALLY_PAID");
    const first = await prisma.paymentRecord.findFirstOrThrow({ where: { settlementId: s.id } });
    expect((await recordPayment(ADMIN, s.id, 0, "2026-11-30", null, first.id)).ok).toBeTruthy(); // Storno
    expect((await prisma.payrollSettlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("SETTLED");
    expect((await recordPayment(ADMIN, s.id, 16500, "2026-12-01", "Überweisung")).ok).toBeTruthy();
    expect((await prisma.payrollSettlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PAID");
    await prisma.payrollPeriod.updateMany({ where: { status: "PREPARED" }, data: { status: "CANCELLED" } });
  });
});

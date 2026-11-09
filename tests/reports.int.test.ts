// Excel-Berichte und automatischer Versand gegen die Testdatenbank (Versand über Test-Transport, nichts verlässt den Rechner).
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { monthlyReport, weeklyReport } from "../lib/reports/excel";
import { loadReportFile, saveReport } from "../lib/reports/store";
import { nextRunAt, periodFor, runSchedule } from "../lib/reports/runner";
import { dbDate } from "../lib/time";

let deptId = "";
let empId = "";
const ADMIN = randomUUID();

beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } })).id;
  const e = await prisma.employee.create({
    data: {
      personnelNumber: `R-${randomUUID().slice(0, 8)}`, firstName: "Bericht", lastName: "Aaa-Test", displayName: "Bericht A.", employmentType: "FESTANGESTELLT",
      primaryDeptId: deptId, entryDate: dbDate("2026-01-01"), contracts: { create: { validFrom: dbDate("2026-01-01"), payModel: "SALARIED", weeklyMinutes: 2550 } },
    },
  });
  empId = e.id;
  await prisma.absence.create({ data: { employeeId: e.id, type: "SICK", startDate: dbDate("2026-09-08"), endDate: dbDate("2026-09-08"), status: "CONFIRMED", createdById: ADMIN, days: { create: { date: dbDate("2026-09-08"), creditedMinutes: 510, vacationDayValue: 0, basis: "CONTRACT_DAILY_AVG" } } } });
});
afterAll(() => { delete process.env.MAIL_TRANSPORT; });

const reread = async (wb: ExcelJS.Workbook) => { const b = new ExcelJS.Workbook(); await b.xlsx.load(await wb.xlsx.writeBuffer()); return b; };
// Zeitwerte kommen beim Einlesen als Datum zurück (Excel-Tag 0 = 30.12.1899)
const mins = (v: unknown) => Math.round(v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 60000 : Number(v) * 1440);
const rowOf = (ws: ExcelJS.Worksheet, name: string) => { let r: ExcelJS.Row | undefined; ws.eachRow((row) => { if (String(row.getCell(1).value).includes(name)) r = row; }); return r; };

describe("Excel-Berichte", () => {
  it("Wochenbericht: Blätter, Krankheit als Excel-Zeitwert, Dateiname", async () => {
    const { wb, fileName } = await weeklyReport(prisma, "2026-09-07", "KUECHE");
    expect(fileName).toBe("NAYA-TIME_Woche_2026-09-07_Küche.xlsx");
    const b = await reread(wb);
    expect(b.worksheets.map((w) => w.name)).toEqual(["Übersicht", "Tage", "Abwesenheiten", "Hinweise"]);
    const row = rowOf(b.getWorksheet("Übersicht")!, "Aaa-Test")!;
    expect(mins(row.getCell(7).value)).toBe(510);
    expect(mins(row.getCell(4).value)).toBe(2550); // Soll Woche 42:30
  });
  it("Monatsbericht: Festangestellte mit Soll 184:10 und Status vorläufig", async () => {
    const b = await reread((await monthlyReport(prisma, "2026-09", "ALL")).wb);
    const row = rowOf(b.getWorksheet("Festangestellte")!, "Aaa-Test")!;
    expect(mins(row.getCell(3).value)).toBe(11050);
    expect(row.getCell(15).value).toBe("vorläufig");
  });
  it("Bericht wird verschlüsselt abgelegt und unverändert wieder gelesen", async () => {
    const built = await weeklyReport(prisma, "2026-09-07", "ALL");
    const { report, buffer } = await saveReport(prisma, built, "WEEKLY", "ALL", ADMIN);
    const back = await loadReportFile(report.storageKey);
    expect(back.equals(buffer)).toBe(true);
    expect(buffer.subarray(0, 2).toString()).toBe("PK"); // xlsx = ZIP
  });
});

describe("Automatischer Versand", () => {
  it("Termine: Wochenbericht montags 08:00, Monatsbericht am 3. – jeweils deutsche Zeit", () => {
    const w = nextRunAt({ reportType: "WEEKLY", dayOfWeek: 1, dayOfMonth: null, timeOfDay: "08:00" }, new Date("2026-11-09T10:00:00Z"));
    expect(w.toISOString()).toBe("2026-11-16T07:00:00.000Z"); // Winterzeit: 08:00 = 07:00 UTC
    const m = nextRunAt({ reportType: "MONTHLY", dayOfWeek: null, dayOfMonth: 3, timeOfDay: "08:00" }, new Date("2026-11-09T10:00:00Z"));
    expect(m.toISOString()).toBe("2026-12-03T07:00:00.000Z");
    expect(periodFor("WEEKLY", "2026-11-16")).toBe("2026-11-09");
    expect(periodFor("MONTHLY", "2026-12-03")).toBe("2026-11");
  });
  it("ohne SMTP: Bericht wird erstellt, Versand als fehlgeschlagen protokolliert; mit Transport: gesendet", async () => {
    const r = await prisma.emailRecipient.upsert({ where: { email: "test@example.com" }, update: { active: true }, create: { email: "test@example.com" } });
    const s = await prisma.reportSchedule.create({ data: { name: "Test", reportType: "WEEKLY", dayOfWeek: 1, timeOfDay: "08:00", recipients: { create: { recipientId: r.id } } }, include: { recipients: { include: { recipient: true } } } });
    delete process.env.MAIL_TRANSPORT;
    const prevHost = process.env.SMTP_HOST; delete process.env.SMTP_HOST;
    expect(await runSchedule(prisma, s, new Date("2026-11-16T07:00:00Z"), null)).toMatchObject({ sent: 0, failed: 1 });
    process.env.MAIL_TRANSPORT = "json";
    expect(await runSchedule(prisma, s, new Date("2026-11-16T07:00:00Z"), null)).toMatchObject({ sent: 1, failed: 0 });
    if (prevHost) process.env.SMTP_HOST = prevHost;
    const logs = await prisma.emailDeliveryLog.findMany({ where: { report: { scheduleId: s.id } }, orderBy: { sentAt: "asc" } });
    expect(logs.map((l) => l.status)).toEqual(["FAILED", "SENT"]);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } })).nextRunAt?.toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { buildCalendar, yearTable, type CalEmployee } from "../lib/calc/vacation-calendar";
import { monthPdf, yearPdf } from "../lib/reports/vacation-pdf";

const emps: CalEmployee[] = [{ id: "a", name: "Ayşe Yılmaz", dept: "KUECHE" }, { id: "b", name: "Данило Коваль", dept: "KUECHE" }, { id: "c", name: "Jürgen Weiß", dept: "SERVICE" }];
const entries = [
  { employeeId: "a", from: "2026-12-21", to: "2026-12-23", kind: "U" as const, days: [{ date: "2026-12-21", value: 2 }] },
  { employeeId: "b", from: "2026-12-22", to: "2026-12-24", kind: "A" as const },
];
describe("Urlaub als PDF", () => {
  it("Monat und Jahr mit Sonderzeichen in Namen", async () => {
    const m = await monthPdf(buildCalendar(emps, entries, "2026-12-01", "2026-12-31"), "2026-12", "09.11.26");
    const y = await yearPdf(yearTable(emps, entries, 2026), 2026, "09.11.26");
    expect(Buffer.from(m.slice(0, 5)).toString()).toBe("%PDF-");
    expect(y.length).toBeGreaterThan(2000);
  });
});

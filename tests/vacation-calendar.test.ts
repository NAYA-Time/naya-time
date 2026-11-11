import { describe, expect, it } from "vitest";
import { buildCalendar, yearTable, type CalEmployee } from "../lib/calc/vacation-calendar";

const emps: CalEmployee[] = [
  { id: "a", name: "Sara Klein", dept: "SERVICE" }, { id: "b", name: "Levin Test", dept: "SERVICE" }, { id: "c", name: "Ali Koch", dept: "KUECHE" },
];
const full = (from: string, to: string) => { const out = []; for (let d = from; d <= to; d = new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10)) out.push({ date: d, value: 2 }); return out; };

describe("Urlaubskalender", () => {
  const cal = buildCalendar(emps, [
    { employeeId: "a", from: "2026-12-21", to: "2026-12-23", kind: "U", days: full("2026-12-21", "2026-12-23") },
    { employeeId: "b", from: "2026-12-22", to: "2026-12-28", kind: "A" },
    { employeeId: "c", from: "2026-12-22", to: "2026-12-22", kind: "U", days: full("2026-12-22", "2026-12-22") },
  ], "2026-12-01", "2026-12-31");
  it("Gruppen Küche vor Service, Zählung je Tag", () => {
    expect(cal.groups.map((g) => g.dept)).toEqual(["KUECHE", "SERVICE"]);
    expect(cal.groups[1].count["2026-12-22"]).toBe(2);
    expect(cal.total["2026-12-22"]).toBe(3);
  });
  it("Überschneidung nur innerhalb einer Abteilung, Antrag gekennzeichnet", () => {
    expect(cal.overlaps).toEqual([{ from: "2026-12-22", to: "2026-12-23", dept: "SERVICE", names: ["Levin Test (Antrag)", "Sara Klein"] }]);
  });
  it("Tage: Urlaub nach Anrechnung, Antrag als Kalendertage", () => {
    const s = cal.groups[1].rows.find((r) => r.emp.id === "a")!;
    const l = cal.groups[1].rows.find((r) => r.emp.id === "b")!;
    expect([s.vacDays, l.requestedDays]).toEqual([3, 7]);
  });
  it("Jahr: Urlaub über den Monatswechsel wird aufgeteilt", () => {
    const y = yearTable(emps, [{ employeeId: "c", from: "2026-01-30", to: "2026-02-02", kind: "U", days: [{ date: "2026-01-30", value: 2 }, { date: "2026-01-31", value: 0 }, { date: "2026-02-01", value: 0 }, { date: "2026-02-02", value: 2 }] }], 2026);
    const r = y.groups[0].rows[0];
    expect([r.months[0].vac, r.months[1].vac, r.vacDays]).toEqual([1, 1, 2]);
  });
});

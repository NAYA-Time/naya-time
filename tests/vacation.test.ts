import { describe, expect, it } from "vitest";
import { vacationYear, type VacInput } from "../lib/calc/vacation";

const base = (o: Partial<VacInput>): VacInput => ({ entryDate: "2025-01-01", daysPerYear: 25, today: "2026-02-01", year: 2026, days: [], adjust: new Map(), reminder: new Map(), ...o });
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10), value: 1 }));

describe("Urlaubsübertrag", () => {
  it("Rest 2025 (5 Tage) wird übertragen", () => {
    const r = vacationYear(base({ days: days("2025-06-01", 20) }));
    expect(r).toMatchObject({ entitlement: 25, carry: 5, carryOpen: 5, rest: 30 });
  });
  it("bis 31.03. genommen → nichts verfällt", () => {
    const r = vacationYear(base({ today: "2026-05-01", days: [...days("2025-06-01", 20), ...days("2026-02-02", 5)], reminder: new Map([[2025, "2025-10-01"]]) }));
    expect(r).toMatchObject({ carry: 5, expired: 0, taken: 5, rest: 25 });
  });
  it("nach 31.03. mit Hinweis: Rest des Übertrags verfällt", () => {
    const r = vacationYear(base({ today: "2026-04-01", days: [...days("2025-06-01", 20), ...days("2026-03-30", 2)], reminder: new Map([[2025, "2025-10-01"]]) }));
    expect(r).toMatchObject({ carry: 5, expired: 3, taken: 2, rest: 25, reminderMissing: false });
  });
  it("nach 31.03. ohne Hinweis: nichts verfällt, Warnung", () => {
    const r = vacationYear(base({ today: "2026-04-01", days: days("2025-06-01", 20) }));
    expect(r).toMatchObject({ expired: 0, rest: 30, reminderMissing: true });
  });
  it("Eintritt im Jahr: anteilig, kein Übertrag", () => {
    expect(vacationYear(base({ entryDate: "2026-07-15", today: "2026-08-01" }))).toMatchObject({ entitlement: 10.5, carry: 0 });
  });
});

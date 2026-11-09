import { describe, expect, it } from "vitest";
import { computeMonth, type MonthInput } from "../lib/calc/month";

const H = 60;
const base = (over: Partial<MonthInput> = {}): MonthInput => ({
  month: "2026-11", today: "2026-12-05", entryDate: "2024-01-01", exitDate: null,
  contracts: [{ validFrom: "2024-01-01", validTo: null, payModel: "SALARIED", weeklyMinutes: 2550, monthlyMinutes: null, monthlyTargetMethod: "WEEKLY_AVERAGE", workdaysMask: 31, workdaysPerWeek: 5 }],
  overtimeRules: [{ validFrom: "2024-01-01", validTo: null, includedMinutesPerMonth: 10 * H }],
  sessions: [], absenceDays: [], plannedShifts: [], balanceBefore: 0,
  ...over,
});
const worked = (min: number) => [{ workDate: "2026-11-10", status: "CLOSED" as const, payableMinutes: min }];

describe("Monatsabschluss Festangestellte (42:30/Woche, 10 Std. abgegolten)", () => {
  it("Soll 184:10 nach Wochenschnitt", () => {
    expect(computeMonth(base()).target).toBe(184 * H + 10);
  });
  it("16: genau 10 Std. Mehrarbeit → alles abgegolten, Konto unverändert, Mehrarbeit bleibt dokumentiert", () => {
    const r = computeMonth(base({ sessions: worked(194 * H + 10) }));
    expect([r.overtime, r.included, r.compensable, r.accountChange]).toEqual([600, 600, 0, 0]);
  });
  it("17: 16 Std. Mehrarbeit → 10 abgegolten, 6 Std. aufs Konto", () => {
    const r = computeMonth(base({ sessions: worked(200 * H + 10), balanceBefore: 90 }));
    expect([r.included, r.compensable, r.accountChange, r.balanceAfter]).toEqual([600, 360, 360, 450]);
  });
  it("18: abgegoltene Stunden werden nicht in den Folgemonat übertragen", () => {
    const r = computeMonth(base({ sessions: worked(189 * H + 10) })); // 5 Std. Mehrarbeit, 5 Std. "Rest" verfällt
    expect([r.included, r.accountChange]).toEqual([300, 0]);
  });
  it("19: 4 Std. zu wenig → automatisch Minusstunden, Übertrag 'aus Vormonaten'", () => {
    const r = computeMonth(base({ sessions: worked(180 * H + 10), balanceBefore: 120 }));
    expect([r.deficit, r.decision, r.minusBooked, r.accountChange, r.balanceAfter]).toEqual([240, "AUTO_BOOKED", 240, -240, -120]);
  });
  it("20: Defizit vom Betrieb verursacht (Unterplanung) → keine Minusstunden, Hinweis", () => {
    const r = computeMonth(base({ sessions: worked(150 * H), plannedShifts: [{ workDate: "2026-11-10", netMinutes: 150 * H }], decision: "EMPLOYER_CAUSED" }));
    expect([r.minusBooked, r.accountChange]).toEqual([0, 0]);
    expect(r.hints.join()).toMatch(/Unterplanung/);
  });
  it("Krankheit und Urlaub zählen wie Arbeit", () => {
    const r = computeMonth(base({ sessions: worked(150 * H), absenceDays: [{ date: "2026-11-02", type: "SICK", creditedMinutes: 510 }, { date: "2026-11-03", type: "VACATION", creditedMinutes: 510 }] }));
    expect([r.sick, r.vacation, r.actual]).toEqual([510, 510, 150 * H + 1020]);
  });
  it("Freizeitausgleich: angerechnet, aber vom Konto abgebucht – auch wenn Mehrarbeit abgegolten ist", () => {
    const r = computeMonth(base({ sessions: worked(181 * H + 10), absenceDays: [{ date: "2026-11-20", type: "TIME_OFF_IN_LIEU", creditedMinutes: 8 * H }] }));
    // 5 Std. über Soll → abgegolten; 8 Std. Freizeitausgleich gehen vom Konto
    expect([r.included, r.compensable, r.timeOff, r.accountChange]).toEqual([300, 0, 480, -480]);
  });
  it("Eintritt am 16. → Soll anteilig (15 von 30 Tagen)", () => {
    expect(computeMonth(base({ entryDate: "2026-11-16" })).target).toBe(Math.round(11050 / 2));
  });
  it("Eintritt am 16. → inklusive Überstunden anteilig (5 statt 10 Std.)", () => {
    const r = computeMonth(base({ entryDate: "2026-11-16", sessions: worked(92 * H + 5 + 8 * H) })); // Soll 92:05, 8 Std. Mehrarbeit
    expect([r.employedDays, r.included, r.compensable, r.accountChange]).toEqual([15, 300, 180, 180]);
  });
  it("Kind krank und Unbezahlt: keine Gutschrift, aber auch keine Minusstunden (Soll sinkt um das Tagessoll)", () => {
    const r = computeMonth(base({ sessions: worked(184 * H + 10 - 2 * 510), absenceDays: [{ date: "2026-11-02", type: "SICK_CHILD", creditedMinutes: 0 }, { date: "2026-11-03", type: "UNPAID", creditedMinutes: 0 }, { date: "2026-11-07", type: "UNPAID", creditedMinutes: 0 }] }));
    expect([r.unpaid, r.target, r.deficit, r.accountChange]).toEqual([1020, 184 * H + 10 - 1020, 0, 0]); // 07.11. ist Samstag → kein Soll
    expect(r.hints.join()).toMatch(/unbezahlt/);
  });
  it("Vertragswechsel zur Monatsmitte (42:30 → 30:00) → Soll tageweise gemischt", () => {
    const r = computeMonth(base({ contracts: [
      { validFrom: "2024-01-01", validTo: "2026-11-15", payModel: "SALARIED", weeklyMinutes: 2550, monthlyMinutes: null, monthlyTargetMethod: "WEEKLY_AVERAGE", workdaysMask: 31, workdaysPerWeek: 5 },
      { validFrom: "2026-11-16", validTo: null, payModel: "SALARIED", weeklyMinutes: 1800, monthlyMinutes: null, monthlyTargetMethod: "WEEKLY_AVERAGE", workdaysMask: 31, workdaysPerWeek: 5 },
    ] }));
    expect(r.target).toBe(Math.round(11050 / 2 + 7800 / 2));
  });
  const xmas = (over: Partial<MonthInput> = {}) => base({ month: "2026-12", today: "2027-01-05", ...over });
  const shift25 = [{ workDate: "2026-12-25", netMinutes: 480 }];
  it("Standard (Gunnar): Feiertag wird nicht gutgeschrieben, auch wenn ein Dienst geplant war", () => {
    expect(computeMonth(xmas({ plannedShifts: shift25 })).holiday).toBe(0);
  });
  it("Regel geplanter Dienst: Feiertag (25.12.2026), Dienst fällt aus → geplanter Dienst gutgeschrieben", () => {
    expect(computeMonth(xmas({ plannedShifts: shift25, holidayRule: "PLANNED_SHIFT" })).holiday).toBe(480);
  });
  it("Regel geplanter Dienst: ohne geplanten Dienst keine Gutschrift", () => {
    expect(computeMonth(xmas({ holidayRule: "PLANNED_SHIFT" })).holiday).toBe(0);
  });
  it("Regel Tagessoll: Feiertag an Vertragsarbeitstag ohne Arbeit → 8:30 gutgeschrieben, 26.12. (Samstag) nicht", () => {
    expect(computeMonth(xmas({ holidayRule: "WORKDAY_TARGET" })).holiday).toBe(510);
  });
  it("Feiertag gearbeitet → keine zusätzliche Gutschrift", () => {
    expect(computeMonth(xmas({ holidayRule: "PLANNED_SHIFT", plannedShifts: shift25, sessions: [{ workDate: "2026-12-25", status: "CLOSED", payableMinutes: 480 }] })).holiday).toBe(0);
  });
  it("Urlaub über den Feiertag → kein Urlaubstag verbraucht, Feiertag nach Regel gutgeschrieben", () => {
    const r = computeMonth(xmas({ holidayRule: "WORKDAY_TARGET", absenceDays: [{ date: "2026-12-24", type: "VACATION", creditedMinutes: 510 }, { date: "2026-12-25", type: "VACATION", creditedMinutes: 0 }] }));
    expect([r.vacation, r.holiday]).toEqual([510, 510]);
  });
  it("Sperren: offene Schicht, laufender Monat, Aushilfe", () => {
    expect(computeMonth(base({ sessions: [{ workDate: "2026-11-12", status: "MISSING_CLOCK_OUT", payableMinutes: 0 }] })).blockers.join()).toMatch(/offene Schicht/);
    expect(computeMonth(base({ today: "2026-11-20" })).blockers.join()).toMatch(/nicht vorbei/);
    const c = base().contracts[0];
    expect(computeMonth(base({ contracts: [{ ...c, payModel: "HOURLY" }] })).blockers.join()).toMatch(/Aushilfe/);
  });
});

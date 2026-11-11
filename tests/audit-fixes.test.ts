// Rechenregeln, die im Systemaudit vom 10.11.2026 als fehlerhaft aufgefallen sind (B1, B2).
import { describe, expect, it } from "vitest";
import { absenceDay, capAbsenceByWork, datesBetween } from "../lib/calc/absence";
import { computeMonth, type MonthInput } from "../lib/calc/month";
import { maskCount, maskLabel, parseWorkdays } from "../lib/workdays";

const fd = (days: number[]) => { const f = new FormData(); f.set("wdPresent", "1"); for (const d of days) f.append("wd", String(d)); return f; };

describe("B1: Arbeitstage je Mitarbeiter", () => {
  it("Kästchen werden zur Bitmaske (Mo = Bit 0), Tage/Woche ergibt sich daraus", () => {
    expect(parseWorkdays(fd([2, 3, 4, 5, 6]))).toEqual({ mask: 0b1111100, perWeek: 5 }); // Mi–So
    expect(parseWorkdays(fd([]))).toMatchObject({ error: expect.stringMatching(/mindestens/) });
    expect(parseWorkdays(new FormData())).toBeNull();
    expect([maskLabel(0b1111100), maskCount(0b0111111)]).toEqual(["Mi, Do, Fr, Sa, So", 6]);
  });
  it("Mi–So-Kraft: Urlaub am Wochenende zählt als Urlaubstag mit Tagessoll, Mo/Di nicht", () => {
    const c = { weeklyMinutes: 2400, workdaysPerWeek: 5, workdaysMask: 0b1111100 };
    const week = datesBetween("2026-11-09", "2026-11-15").map((d) => absenceDay("VACATION", d, c, []));
    expect(week.map((x) => x.vacationDayValue / 2)).toEqual([0, 0, 1, 1, 1, 1, 1]);
    expect(week.reduce((a, x) => a + x.creditedMinutes, 0)).toBe(2400);
  });
  it("6-Tage-Kraft mit 48 Std.: eine Woche Urlaub = 6 Tage und 48 Std.", () => {
    const c = { weeklyMinutes: 2880, workdaysPerWeek: 6, workdaysMask: 0b0111111 };
    const week = datesBetween("2026-11-09", "2026-11-15").map((d) => absenceDay("VACATION", d, c, []));
    expect([week.reduce((a, x) => a + x.vacationDayValue, 0) / 2, week.reduce((a, x) => a + x.creditedMinutes, 0)]).toEqual([6, 2880]);
  });
  it("Krank am Samstag ohne Dienstplan: Tagessoll, wenn Samstag Arbeitstag ist", () => {
    expect(absenceDay("SICK", "2026-11-14", { weeklyMinutes: 2400, workdaysPerWeek: 5, workdaysMask: 0b1111100 }, []).creditedMinutes).toBe(480);
    expect(absenceDay("SICK", "2026-11-14", { weeklyMinutes: 2400, workdaysPerWeek: 5, workdaysMask: 31 }, []).creditedMinutes).toBe(0);
  });
});

describe("B2: Arbeit und Abwesenheit am selben Tag", () => {
  it("Abwesenheit füllt nur die nicht gearbeitete Zeit auf", () => {
    const days = [{ date: "2026-11-10", creditedMinutes: 480 }, { date: "2026-11-11", creditedMinutes: 480 }];
    expect(capAbsenceByWork(days, new Map([["2026-11-10", 120]])).map((d) => d.creditedMinutes)).toEqual([360, 480]);
    expect(capAbsenceByWork(days, new Map([["2026-11-10", 600]])).map((d) => d.creditedMinutes)).toEqual([0, 480]);
  });
  it("Monat: 2 Std. gearbeitet + krank (8 Std. Dienst) = 8 Std. Ist, nicht 10", () => {
    const inp: MonthInput = {
      month: "2026-11", today: "2026-12-05", entryDate: "2024-01-01", exitDate: null,
      contracts: [{ validFrom: "2024-01-01", validTo: null, payModel: "SALARIED", weeklyMinutes: 2400, monthlyMinutes: null, monthlyTargetMethod: "WEEKLY_AVERAGE", workdaysMask: 31, workdaysPerWeek: 5 }],
      overtimeRules: [], plannedShifts: [], balanceBefore: 0,
      sessions: [{ workDate: "2026-11-10", status: "CLOSED", payableMinutes: 120 }],
      absenceDays: [{ date: "2026-11-10", type: "SICK", creditedMinutes: 480 }],
    };
    const r = computeMonth(inp);
    expect([r.worked, r.sick, r.actual]).toEqual([120, 360, 480]);
    expect(r.hints.join(" ")).toMatch(/nur für die nicht gearbeitete Zeit/);
  });
});

import { describe, expect, it } from "vitest";
import { absenceDay, datesBetween } from "../lib/calc/absence";
import { berlinToInstant } from "../lib/time";

const vollzeit = { weeklyMinutes: 2550, workdaysPerWeek: 5, workdaysMask: 0b0011111 }; // Mo–Fr, 42:30 → 8:30/Tag
const shift = (d: string) => ({ startAt: berlinToInstant(d, "13:30"), endAt: berlinToInstant(d, "22:00"), plannedBreakMinutes: 30 });

describe("Abwesenheiten", () => {
  it("12: ein Tag krank mit Dienst 13:30–22:00 → 8 Std. angerechnet, keine Minusstunden", () => {
    const r = absenceDay("SICK", "2026-11-09", vollzeit, [shift("2026-11-09")]);
    expect(r.creditedMinutes).toBe(480);
    expect(r.basis).toBe("SCHEDULE_SNAPSHOT");
    expect(r.shiftSnapshot).toHaveLength(1);
  });
  it("13: eine Woche krank: geplante Dienste Mo–Fr, Sa/So frei → 5 × 8 Std.", () => {
    const days = datesBetween("2026-11-09", "2026-11-15");
    const sum = days.reduce((a, d) => a + absenceDay("SICK", d, vollzeit, weekdayShifts(d)).creditedMinutes, 0);
    expect(days).toHaveLength(7);
    expect(sum).toBe(5 * 480);
  });
  it("Krank ohne geplanten Dienst an einem Arbeitstag → Tagessoll 8:30", () => {
    expect(absenceDay("SICK", "2026-11-10", vollzeit, []).creditedMinutes).toBe(510);
  });
  it("14: Urlaub zählt nur Arbeitstage, nicht den Feiertag", () => {
    const days = datesBetween("2026-12-21", "2026-12-27"); // 25./26.12. Feiertage (Fr/Sa)
    const r = days.map((d) => absenceDay("VACATION", d, vollzeit, []));
    expect(r.reduce((a, x) => a + x.vacationDayValue, 0) / 2).toBe(4); // Mo–Do
    expect(r.find((x) => x.date === "2026-12-25")!.holiday).toBe("1. Weihnachtstag");
  });
  it("Unbezahlter Urlaub → keine Anrechnung", () => {
    expect(absenceDay("UNPAID", "2026-11-09", vollzeit, [shift("2026-11-09")]).creditedMinutes).toBe(0);
  });
});
function weekdayShifts(d: string) {
  const wd = new Date(d + "T12:00:00Z").getUTCDay();
  return wd >= 1 && wd <= 5 ? [shift(d)] : [];
}

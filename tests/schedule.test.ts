import { describe, expect, it } from "vitest";
import { checkPlan } from "../lib/calc/schedule-checks";
import { berlinToInstant } from "../lib/time";

const s = (id: string, d: string, a: string, b: string, brk = 30, d2 = d) => ({ id, employeeId: "e", startAt: berlinToInstant(d, a), endAt: berlinToInstant(d2, b), plannedBreakMinutes: brk });

describe("Dienstplan-Prüfungen", () => {
  it("Doppelbelegung", () => {
    expect(checkPlan([s("1", "2026-11-09", "10:00", "16:00"), s("2", "2026-11-09", "15:00", "22:00")], new Map()).some((w) => w.code === "OVERLAP")).toBe(true);
  });
  it("Ruhezeit unter 11 Std. (Spätdienst bis 23:30, Frühdienst ab 08:00)", () => {
    const w = checkPlan([s("1", "2026-11-09", "15:00", "23:30"), s("2", "2026-11-10", "08:00", "14:00")], new Map());
    expect(w.find((x) => x.code === "REST")?.message).toContain("8:30");
  });
  it("Zu wenig geplante Wochenstunden → Hinweis Unterplanung", () => {
    const w = checkPlan([s("1", "2026-11-09", "13:30", "22:00")], new Map([["e", 2550]]));
    expect(w.some((x) => x.code === "WEEK_UNDER")).toBe(true);
  });
  it("Dienst über Mitternacht mit zu kurzer Pause", () => {
    const w = checkPlan([s("1", "2026-11-09", "18:00", "04:00", 30, "2026-11-10")], new Map());
    expect(w.some((x) => x.code === "BREAK")).toBe(true); // 9:30 netto → 45 Min. nötig
  });
});

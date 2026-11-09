import { describe, expect, it } from "vitest";
import { computeSession, requiredBreakForPresence } from "../lib/calc/session";
import { berlinToInstant } from "../lib/time";

const t = (hm: string, day = "2026-11-09") => berlinToInstant(day, hm);

describe("Arbeitsschicht", () => {
  it("1: pünktlich eingestempelt", () => {
    const r = computeSession({ clockIn: t("13:30"), clockOut: t("22:00"), plannedStart: t("13:30"), plannedEnd: t("22:00"), breaks: [{ minutes: 30 }] });
    expect(r.workedMinutes).toBe(480);
    expect(r.payableMinutes).toBe(480);
    expect(r.lateMinutes).toBe(0);
  });

  it("2: 15 Minuten zu früh → vergütet ab geplantem Beginn, Original bleibt", () => {
    const r = computeSession({ clockIn: t("13:15"), clockOut: t("22:00"), plannedStart: t("13:30"), plannedEnd: t("22:00"), breaks: [{ minutes: 30 }] });
    expect(r.earlyArrivalMinutes).toBe(15);
    expect(r.presenceMinutes).toBe(525);
    expect(r.payableMinutes).toBe(480);
    expect(r.effectiveStart.getTime()).toBe(t("13:30").getTime());
  });

  it("2b: genehmigte frühere Arbeit wird vergütet", () => {
    const r = computeSession({ clockIn: t("13:15"), clockOut: t("22:00"), plannedStart: t("13:30"), breaks: [{ minutes: 30 }], earlyStartApproved: true });
    expect(r.payableMinutes).toBe(495);
  });

  it("3: 30 Minuten zu spät", () => {
    const r = computeSession({ clockIn: t("14:00"), clockOut: t("22:00"), plannedStart: t("13:30"), plannedEnd: t("22:00"), breaks: [{ minutes: 30 }] });
    expect(r.lateMinutes).toBe(30);
    expect(r.payableMinutes).toBe(450);
  });

  it("4: 45 Minuten nach geplantem Ende → zählt voll, wird als Überzug ausgewiesen", () => {
    const r = computeSession({ clockIn: t("13:30"), clockOut: t("22:45"), plannedStart: t("13:30"), plannedEnd: t("22:00"), breaks: [{ minutes: 30 }] });
    expect(r.overrunMinutes).toBe(45);
    expect(r.payableMinutes).toBe(525);
  });

  it("8/9: Pausenbedarf über 6 bzw. 9 Stunden", () => {
    expect(requiredBreakForPresence(360)).toBe(0);
    expect(requiredBreakForPresence(361)).toBe(30);
    expect(requiredBreakForPresence(570)).toBe(30); // 9:30 Anwesenheit = 9:00 Arbeit
    expect(requiredBreakForPresence(571)).toBe(45);
  });

  it("10: keine Pause genommen → nichts abgezogen, Fehlbetrag ausgewiesen", () => {
    const r = computeSession({ clockIn: t("12:00"), clockOut: t("20:00"), breaks: [] });
    expect(r.workedMinutes).toBe(480);
    expect(r.breakShortfallMinutes).toBe(30);
  });

  it("33: über Mitternacht", () => {
    const r = computeSession({ clockIn: t("18:00", "2026-11-09"), clockOut: t("02:00", "2026-11-10"), breaks: [{ minutes: 30 }] });
    expect(r.workedMinutes).toBe(450);
  });

  it("34: Sommerzeitbeginn (29.03.2026, 02:00→03:00) – eine Stunde weniger", () => {
    const r = computeSession({ clockIn: t("22:00", "2026-03-28"), clockOut: t("06:00", "2026-03-29"), breaks: [] });
    expect(r.presenceMinutes).toBe(420);
  });

  it("35: Winterzeitbeginn (25.10.2026, 03:00→02:00) – eine Stunde mehr", () => {
    const r = computeSession({ clockIn: t("22:00", "2026-10-24"), clockOut: t("06:00", "2026-10-25"), breaks: [] });
    expect(r.presenceMinutes).toBe(540);
  });
});

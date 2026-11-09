import { describe, expect, it } from "vitest";
import { paymentStatus, preparePayroll, type PaySource, type Wage } from "../lib/calc/payroll";

const wages = new Map<string, Wage[]>([["max", [{ validFrom: "2026-01-01", validTo: "2026-11-14", centsPerHour: 1500 }, { validFrom: "2026-11-15", validTo: null, centsPerHour: 1600 }]]]);
const w = (id: string, workDate: string, minutes: number, extra: Partial<PaySource> = {}): PaySource => ({ kind: "WORK", sourceId: id, employeeId: "max", workDate, minutes, ...extra });

describe("Aushilfenabrechnung mit Stichtag", () => {
  it("22: Stichtag 25.11. → nur Stunden bis einschließlich 25.11.", () => {
    const [m] = preparePayroll("2026-11-25", [w("a", "2026-11-10", 300), w("b", "2026-11-25", 240), w("c", "2026-11-26", 480)], new Map(), wages);
    expect(m.items.map((i) => i.sourceId)).toEqual(["a", "b"]);
  });
  it("23: Stundenlohn gilt je Arbeitstag (Lohnerhöhung zum 15.11.)", () => {
    const [m] = preparePayroll("2026-11-25", [w("a", "2026-11-10", 300), w("b", "2026-11-20", 240)], new Map(), wages);
    expect([m.items[0].amountCents, m.items[1].amountCents, m.grossCents, m.minutes]).toEqual([7500, 6400, 13900, 540]);
  });
  it("24: Stunden vom 26.–31.10. erscheinen im November als Übertrag aus dem Vormonat", () => {
    const [m] = preparePayroll("2026-11-25", [w("okt", "2026-10-28", 360), w("nov", "2026-11-03", 300)], new Map([["WORK:x", 0]]), wages);
    expect([m.carryMinutes, m.carryCents, m.items[0].isCarryOver, m.items[1].isCarryOver]).toEqual([360, 9000, true, false]);
  });
  it("25: bereits abgerechnete Stunden werden nicht doppelt abgerechnet", () => {
    const out = preparePayroll("2026-11-25", [w("a", "2026-11-10", 300)], new Map([["WORK:a", 300]]), wages);
    expect(out).toEqual([]);
  });
  it("26: nachträgliche Korrektur einer abgerechneten Schicht → nur die Differenz als Korrekturposten", () => {
    const [m] = preparePayroll("2026-11-25", [w("a", "2026-11-10", 330)], new Map([["WORK:a", 300]]), wages);
    expect(m.items).toMatchObject([{ kind: "ADJUSTMENT", minutes: 30, amountCents: 750 }]);
  });
  it("offene Schicht (nicht ausgestempelt) wird nicht abgerechnet, nur als Hinweis", () => {
    const [m] = preparePayroll("2026-11-25", [w("a", "2026-11-10", 0, { open: true })], new Map(), wages);
    expect([m.items.length, m.hints[0]]).toEqual([0, expect.stringMatching(/ohne Ausstempeln/)]);
  });
  it("fehlender Stundenlohn sperrt die Abrechnung dieses Mitarbeiters", () => {
    const [m] = preparePayroll("2026-11-25", [{ ...w("a", "2026-11-10", 300), employeeId: "neu" }], new Map(), wages);
    expect(m.blockers[0]).toMatch(/Kein Stundenlohn/);
  });
  it("bezahlte Krankheit wird mit dem Stundenlohn abgerechnet", () => {
    const [m] = preparePayroll("2026-11-25", [{ kind: "PAID_ABSENCE", sourceId: "k1", employeeId: "max", workDate: "2026-11-20", minutes: 360 }], new Map(), wages);
    expect(m.items).toMatchObject([{ kind: "PAID_ABSENCE", amountCents: 9600 }]);
  });
  it("Zahlungsstatus: offen, teilweise, vollständig bezahlt", () => {
    expect([paymentStatus(10000, 0, true), paymentStatus(10000, 4000, true), paymentStatus(10000, 10000, true)]).toEqual(["SETTLED", "PARTIALLY_PAID", "PAID"]);
  });
});

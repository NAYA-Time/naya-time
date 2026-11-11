// Tagesweise Anrechnung von Abwesenheiten (reine Funktion, testbar).
// Krankheit: Lohnausfallprinzip – geplanter Dienst (netto) zum Zeitpunkt der Eintragung; ohne Dienst an einem Vertragsarbeitstag: Tagessoll.
// Urlaub: nur Vertragsarbeitstage, keine Feiertage; Anrechnung Tagessoll, 1 Urlaubstag je Tag.
import { holidayName } from "../holidays";

export interface ContractLike { weeklyMinutes: number | null; workdaysPerWeek: number; workdaysMask: number }
export interface ShiftLike { startAt: Date; endAt: Date; plannedBreakMinutes: number }
export type AbsenceKind = "VACATION" | "SICK" | "SICK_CHILD" | "SPECIAL_LEAVE" | "UNPAID" | "TIME_OFF_IN_LIEU";

export interface DayResult {
  date: string; creditedMinutes: number; vacationDayValue: number; basis: "SCHEDULE_SNAPSHOT" | "CONTRACT_DAILY_AVG" | "NONE";
  shiftSnapshot: { startAt: string; endAt: string; plannedBreakMinutes: number }[] | null; holiday: string | null;
}

export function dailyTarget(c: ContractLike): number {
  if (!c.weeklyMinutes || !c.workdaysPerWeek) return 0;
  return Math.round(c.weeklyMinutes / c.workdaysPerWeek);
}

/** Wochentag-Bit: Mo = 0 … So = 6 */
export function weekdayBit(ymd: string): number {
  const d = new Date(ymd + "T12:00:00Z").getUTCDay(); // 0 = So
  return (d + 6) % 7;
}

export function absenceDay(kind: AbsenceKind, ymd: string, contract: ContractLike, shifts: ShiftLike[]): DayResult {
  const holiday = holidayName(ymd);
  const isWorkday = ((contract.workdaysMask >> weekdayBit(ymd)) & 1) === 1;
  const net = shifts.reduce((a, s) => a + Math.max(0, Math.round((s.endAt.getTime() - s.startAt.getTime()) / 60000) - s.plannedBreakMinutes), 0);
  const snapshot = shifts.length ? shifts.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), plannedBreakMinutes: s.plannedBreakMinutes })) : null;
  const base = { date: ymd, holiday, shiftSnapshot: snapshot };

  // Unbezahlt und Kind krank (Gunnar 09.11.2026: unbezahlt, Krankengeld zahlt die Kasse): keine Gutschrift, Soll sinkt im Monatsabschluss
  if (kind === "UNPAID" || kind === "SICK_CHILD") return { ...base, creditedMinutes: 0, vacationDayValue: 0, basis: "NONE" };
  if (kind === "VACATION") {
    if (holiday || (!isWorkday && !shifts.length)) return { ...base, creditedMinutes: 0, vacationDayValue: 0, basis: "NONE" };
    return { ...base, creditedMinutes: dailyTarget(contract), vacationDayValue: 2, basis: "CONTRACT_DAILY_AVG" };
  }
  // Krankheit, Sonderurlaub, Freizeitausgleich
  if (shifts.length) return { ...base, creditedMinutes: net, vacationDayValue: 0, basis: "SCHEDULE_SNAPSHOT" };
  if (isWorkday && !holiday) return { ...base, creditedMinutes: dailyTarget(contract), vacationDayValue: 0, basis: "CONTRACT_DAILY_AVG" };
  return { ...base, creditedMinutes: 0, vacationDayValue: 0, basis: "NONE" };
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * Arbeit und Abwesenheit am selben Tag (z. B. nach 2 Std. krank nach Hause): Die Abwesenheit füllt nur auf,
 * was am Tag nicht gearbeitet wurde. Gutschrift = max(0, Abwesenheit − gearbeitete Minuten des Tages).
 * Die gespeicherte Gutschrift bleibt unverändert; die Kürzung wird bei jeder Rechnung neu ermittelt.
 */
export function capAbsenceByWork<T extends { date: string; creditedMinutes: number }>(days: T[], workedByDate: Map<string, number>): T[] {
  const left = new Map(workedByDate);
  return days.map((d) => {
    const w = left.get(d.date) ?? 0;
    if (w <= 0 || d.creditedMinutes <= 0) return d;
    const used = Math.min(w, d.creditedMinutes);
    left.set(d.date, w - used);
    return { ...d, creditedMinutes: d.creditedMinutes - used };
  });
}

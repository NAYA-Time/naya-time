// Monatsrechnung für Festangestellte (reine Funktion, testbar).
// Soll je Kalendertag aus dem an diesem Tag gültigen Vertrag; Ein-/Austritt und Vertragswechsel im Monat werden tageweise berücksichtigt.
// Ist = vergütete Arbeitszeit + Krank + Urlaub + Feiertag + Sonstige Anrechnung.
// Mehrarbeit: zuerst abgegoltene Stunden (Regel, kein Übertrag), Rest aufs Konto.
// Defizit: Standard AUTO_BOOKED (Gunnar 08.11.2026) → Minusstunden, Übertrag in den nächsten Monat ("aus Vormonaten").
// Freizeitausgleich wird angerechnet und zugleich vom Konto abgebucht.
import { capAbsenceByWork, dailyTarget, datesBetween, weekdayBit } from "./absence";
import { holidayName } from "../holidays";

export type TargetMethod = "WEEKLY_AVERAGE" | "CALENDAR_EXACT" | "FIXED_MONTHLY";
export type Decision = "AUTO_BOOKED" | "EMPLOYEE_CAUSED" | "EMPLOYER_CAUSED";

export interface MonthContract {
  validFrom: string; validTo: string | null; payModel: "SALARIED" | "HOURLY";
  weeklyMinutes: number | null; monthlyMinutes: number | null; monthlyTargetMethod: TargetMethod;
  workdaysMask: number; workdaysPerWeek: number; accountLimitPlus?: number | null; accountLimitMinus?: number | null;
}
export interface MonthInput {
  month: string; // "2026-11"
  today: string; // für "Monat noch nicht vorbei"
  entryDate: string; exitDate: string | null;
  contracts: MonthContract[];
  overtimeRules: { validFrom: string; validTo: string | null; includedMinutesPerMonth: number }[];
  sessions: { workDate: string; status: "OPEN" | "CLOSED" | "MISSING_CLOCK_OUT"; payableMinutes: number }[];
  absenceDays: { date: string; type: string; creditedMinutes: number }[];
  plannedShifts: { workDate: string; netMinutes: number }[];
  balanceBefore: number;
  decision?: Decision;
  /** Feiertagsgutschrift: NONE (Standard, Gunnar 09.11.2026) = nur gearbeitete Zeit zählt; PLANNED_SHIFT = geplanter Dienst fällt aus; WORKDAY_TARGET = Tagessoll an Vertragsarbeitstagen */
  holidayRule?: HolidayRule;
}
export type HolidayRule = "PLANNED_SHIFT" | "WORKDAY_TARGET" | "NONE";
export interface MonthResult {
  month: string; first: string; last: string;
  target: number; avgContract: number; unpaid: number; employedDays: number; worked: number; sick: number; vacation: number; holiday: number; other: number; timeOff: number;
  planned: number; actual: number; diff: number;
  overtime: number; included: number; compensable: number;
  deficit: number; decision: "NONE" | Decision; minusBooked: number;
  accountChange: number; balanceBefore: number; balanceAfter: number;
  holidays: { date: string; name: string; credited: number }[];
  blockers: string[]; hints: string[];
}

export const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last, days: Number(last.slice(8)) };
};
export const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const hm = (m: number) => `${m < 0 ? "-" : ""}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

/** Rechnerischer Monatsdurchschnitt eines Vertrags (42:30/Woche → 184:10) */
export function monthlyAverage(c: Pick<MonthContract, "weeklyMinutes" | "monthlyMinutes" | "monthlyTargetMethod">): number {
  if (c.monthlyTargetMethod === "FIXED_MONTHLY" && c.monthlyMinutes != null) return c.monthlyMinutes;
  return Math.round(((c.weeklyMinutes ?? 0) * 13) / 3);
}

export function computeMonth(raw: MonthInput): MonthResult {
  // Abwesenheit nur für die nicht gearbeitete Zeit des Tages anrechnen (keine Doppelzählung)
  const workedByDate = new Map<string, number>();
  for (const s of raw.sessions) if (s.status === "CLOSED") workedByDate.set(s.workDate, (workedByDate.get(s.workDate) ?? 0) + s.payableMinutes);
  const capped = capAbsenceByWork(raw.absenceDays, workedByDate);
  const cappedDays = capped.filter((a, i) => a.creditedMinutes !== raw.absenceDays[i].creditedMinutes).length;
  const inp: MonthInput = { ...raw, absenceDays: capped };
  const { first, last, days } = monthBounds(inp.month);
  const blockers: string[] = [];
  const hints: string[] = [];
  const contractAt = (d: string) => inp.contracts.find((c) => c.validFrom <= d && (!c.validTo || c.validTo >= d));
  const employed = (d: string) => d >= inp.entryDate && (!inp.exitDate || d <= inp.exitDate);

  const rule: HolidayRule = inp.holidayRule ?? "NONE";
  const absByDate = new Map<string, number>();
  for (const a of inp.absenceDays) if (a.creditedMinutes > 0) absByDate.set(a.date, (absByDate.get(a.date) ?? 0) + 1);
  const workedDates = new Set(inp.sessions.filter((s) => s.payableMinutes > 0).map((s) => s.workDate));

  // Unbezahlte Tage (Unbezahlt, Kind krank): Soll entfällt an Vertragsarbeitstagen – keine Minusstunden, Kürzung macht das Lohnbüro
  const unpaidDates = new Set(inp.absenceDays.filter((a) => a.type === "UNPAID" || a.type === "SICK_CHILD").map((a) => a.date));
  let targetExact = 0;
  let unpaidExact = 0;
  let employedDays = 0;
  let avgContract = 0;
  const holidays: MonthResult["holidays"] = [];
  let anyContract = false;
  let hourly = false;
  for (const d of datesBetween(first, last)) {
    const c = contractAt(d);
    if (!c || !employed(d)) continue;
    anyContract = true;
    if (c.payModel === "HOURLY") { hourly = true; continue; }
    employedDays++;
    const avg = monthlyAverage(c);
    avgContract = Math.max(avgContract, avg);
    const isWorkday = ((c.workdaysMask >> weekdayBit(d)) & 1) === 1;
    if (unpaidDates.has(d) && isWorkday && !holidayName(d)) unpaidExact += dailyTarget(c);
    if (c.monthlyTargetMethod === "CALENDAR_EXACT") targetExact += isWorkday ? dailyTarget(c) : 0;
    else targetExact += avg / days; // gleichmäßig auf die Kalendertage verteilt → anteilig bei Ein-/Austritt
    const hol = holidayName(d);
    // Feiertag ohne Arbeit und ohne Abwesenheit: Gutschrift nach Regel
    if (hol) {
      const free = !workedDates.has(d) && !absByDate.has(d);
      const plannedNet = inp.plannedShifts.filter((s) => s.workDate === d).reduce((a, s) => a + s.netMinutes, 0);
      const credited = !free || rule === "NONE" ? 0 : rule === "WORKDAY_TARGET" ? (isWorkday ? dailyTarget(c) : 0) : plannedNet;
      if (isWorkday || plannedNet) holidays.push({ date: d, name: hol, credited });
    }
  }
  const unpaid = Math.round(Math.min(unpaidExact, targetExact));
  const target = Math.round(targetExact) - unpaid;

  if (!anyContract) blockers.push("Kein gültiger Vertrag in diesem Monat");
  if (hourly) blockers.push("Aushilfe – wird über die Aushilfenabrechnung abgerechnet");
  if (inp.today <= last) blockers.push("Der Monat ist noch nicht vorbei");
  const open = inp.sessions.filter((s) => s.status !== "CLOSED");
  if (open.length) blockers.push(`${open.length} offene Schicht${open.length > 1 ? "en" : ""} ohne Ausstempeln (${open.map((s) => s.workDate.slice(8) + "." + s.workDate.slice(5, 7) + ".").join(", ")})`);

  const worked = inp.sessions.filter((s) => s.status === "CLOSED").reduce((a, s) => a + s.payableMinutes, 0);
  const sum = (types: string[]) => inp.absenceDays.filter((a) => types.includes(a.type)).reduce((x, a) => x + a.creditedMinutes, 0);
  const sick = sum(["SICK", "SICK_CHILD"]);
  const vacation = sum(["VACATION"]);
  const timeOff = sum(["TIME_OFF_IN_LIEU"]);
  const other = sum(["SPECIAL_LEAVE"]) + timeOff;
  const holiday = holidays.reduce((a, h) => a + h.credited, 0);
  const planned = inp.plannedShifts.reduce((a, s) => a + s.netMinutes, 0);
  const actual = worked + sick + vacation + holiday + other;
  const diff = actual - target;

  const otRule = [...inp.overtimeRules].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1)).find((r) => r.validFrom <= last && (!r.validTo || r.validTo >= first));
  // Eintritt/Austritt im Monat: inklusive Überstunden anteilig nach Beschäftigungstagen (Gunnar 09.11.2026)
  const includedLimit = Math.round(((otRule?.includedMinutesPerMonth ?? 0) * employedDays) / days);
  const overtime = Math.max(0, diff);
  const included = Math.min(overtime, includedLimit);
  const compensable = overtime - included;
  const deficit = Math.max(0, -diff);
  const decision: MonthResult["decision"] = deficit > 0 ? inp.decision ?? "AUTO_BOOKED" : "NONE";
  const minusBooked = decision === "AUTO_BOOKED" || decision === "EMPLOYEE_CAUSED" ? deficit : 0;
  const accountChange = compensable - minusBooked - timeOff;
  const balanceAfter = inp.balanceBefore + accountChange;

  // Hinweise (keine Sperren)
  const absenceCredit = sick + vacation + other + holiday;
  if (deficit > 0 && planned + absenceCredit < target - 60) {
    hints.push(`Unterplanung: Dienstplan + Abwesenheiten ergeben nur ${hm(planned + absenceCredit)} bei Soll ${hm(target)}. Prüfen, ob die Minusstunden vom Betrieb verursacht sind.`);
  }
  if (cappedDays > 0) hints.push(`An ${cappedDays} Tag${cappedDays > 1 ? "en" : ""} wurde neben Krankheit/Urlaub gearbeitet – die Abwesenheit zählt dort nur für die nicht gearbeitete Zeit.`);
  if (unpaid > 0) hints.push(`${hm(unpaid)} Std. unbezahlt (Kind krank/unbezahlt) – Soll entsprechend gekürzt, Gehaltskürzung über das Lohnbüro.`);
  if (compensable > 0 && includedLimit === 0) hints.push("Keine abgegoltenen Überstunden hinterlegt – alle Mehrstunden gehen aufs Konto.");
  const c = contractAt(last) ?? inp.contracts[0];
  if (c?.accountLimitPlus != null && balanceAfter > c.accountLimitPlus) hints.push(`Kontostand über der Grenze von ${hm(c.accountLimitPlus)}`);
  if (c?.accountLimitMinus != null && balanceAfter < -Math.abs(c.accountLimitMinus)) hints.push(`Kontostand unter der Grenze von -${hm(Math.abs(c.accountLimitMinus))}`);

  return {
    month: inp.month, first, last, target, avgContract, unpaid, employedDays, worked, sick, vacation, holiday, other, timeOff, planned, actual, diff,
    overtime, included, compensable, deficit, decision, minusBooked, accountChange, balanceBefore: inp.balanceBefore, balanceAfter,
    holidays, blockers, hints,
  };
}

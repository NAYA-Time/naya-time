// Aushilfenabrechnung mit frei wählbarem Stichtag (reine Funktion, testbar).
// Offen = vergütungsrelevante Minuten je Quelle − bereits abgerechnete Minuten dieser Quelle.
// Dadurch wird nichts doppelt abgerechnet, und spätere Korrekturen erscheinen als ± Differenz (ADJUSTMENT).
// Übertrag: Stunden aus einem Monat vor dem Stichtagsmonat, die noch nicht abgerechnet waren.

export interface PaySource {
  kind: "WORK" | "PAID_ABSENCE";
  sourceId: string; // workSessionId oder absenceDayId
  employeeId: string;
  workDate: string;
  minutes: number; // vergütungsrelevant (Schicht) bzw. angerechnet (Abwesenheit)
  open?: boolean; // Schicht noch nicht ausgestempelt
}
export interface Wage { validFrom: string; validTo: string | null; centsPerHour: number }
export interface PayItem { kind: "WORK" | "PAID_ABSENCE" | "ADJUSTMENT"; sourceKind: "WORK" | "PAID_ABSENCE"; sourceId: string; workDate: string; minutes: number; centsPerHour: number; amountCents: number; isCarryOver: boolean }
export interface PayEmployee {
  employeeId: string; items: PayItem[]; minutes: number; grossCents: number;
  carryMinutes: number; carryCents: number; blockers: string[]; hints: string[];
}

export const amount = (minutes: number, centsPerHour: number) => Math.round((minutes * centsPerHour) / 60);
const de = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}.`;
const euro = (c: number) => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** Minijob-Verdienstgrenze je Monat (an den Mindestlohn gekoppelt): 2025 556 €, 2026 603 €, 2027 633 € */
export function minijobLimitCents(year: number): number {
  if (year >= 2027) return 63300;
  if (year === 2026) return 60300;
  return 55600;
}

/**
 * Warnhinweise für die Aushilfenabrechnung (blockieren nichts):
 * Minijob – Verdienst im Monat des Stichtags über der Grenze; kurzfristig – mehr als 70 (ab 60 Vorwarnung) Arbeitstage im Kalenderjahr.
 */
export function employmentLimitHints(type: string, cutoff: string, items: { workDate: string; kind: "WORK" | "PAID_ABSENCE"; cents: number }[]): string[] {
  const hints: string[] = [];
  if (type === "MINIJOB") {
    const month = cutoff.slice(0, 7);
    const sum = items.filter((i) => i.workDate.startsWith(month)).reduce((a, i) => a + i.cents, 0);
    const limit = minijobLimitCents(Number(cutoff.slice(0, 4)));
    if (sum > limit) hints.push(`Minijob-Grenze überschritten: ${euro(sum)} im Monat ${month.slice(5)}/${month.slice(0, 4)} (Grenze ${euro(limit)}) – bitte mit dem Lohnbüro klären`);
  }
  if (type === "KURZFRISTIG") {
    const days = new Set(items.filter((i) => i.kind === "WORK" && i.workDate.startsWith(cutoff.slice(0, 4)) && i.workDate <= cutoff).map((i) => i.workDate)).size;
    if (days > 70) hints.push(`Kurzfristige Beschäftigung: ${days} Arbeitstage in ${cutoff.slice(0, 4)} – mehr als 70 erlaubt, bitte mit dem Lohnbüro klären`);
    else if (days >= 60) hints.push(`Kurzfristige Beschäftigung: schon ${days} von höchstens 70 Arbeitstagen in ${cutoff.slice(0, 4)}`);
  }
  return hints;
}

export function preparePayroll(cutoff: string, sources: PaySource[], settled: Map<string, number>, wages: Map<string, Wage[]>): PayEmployee[] {
  const cutoffMonthStart = cutoff.slice(0, 7) + "-01";
  const byEmp = new Map<string, PayEmployee>();
  const get = (id: string) => {
    if (!byEmp.has(id)) byEmp.set(id, { employeeId: id, items: [], minutes: 0, grossCents: 0, carryMinutes: 0, carryCents: 0, blockers: [], hints: [] });
    return byEmp.get(id)!;
  };
  for (const s of [...sources].sort((a, b) => (a.workDate < b.workDate ? -1 : 1))) {
    if (s.workDate > cutoff) continue;
    const e = get(s.employeeId);
    if (s.open) { e.hints.push(`Schicht am ${de(s.workDate)} ohne Ausstempeln – nicht enthalten, wird nach Klärung im nächsten Lauf abgerechnet`); continue; }
    const done = settled.get(`${s.kind}:${s.sourceId}`) ?? 0;
    const open = s.minutes - done;
    if (open === 0) continue;
    const wage = (wages.get(s.employeeId) ?? []).find((w) => w.validFrom <= s.workDate && (!w.validTo || w.validTo >= s.workDate));
    if (!wage) { if (!e.blockers.some((b) => b.startsWith("Kein Stundenlohn"))) e.blockers.push(`Kein Stundenlohn hinterlegt für ${de(s.workDate)}`); continue; }
    const item: PayItem = {
      kind: done !== 0 ? "ADJUSTMENT" : s.kind, sourceKind: s.kind, sourceId: s.sourceId, workDate: s.workDate, minutes: open,
      centsPerHour: wage.centsPerHour, amountCents: amount(open, wage.centsPerHour), isCarryOver: s.workDate < cutoffMonthStart,
    };
    e.items.push(item);
    e.minutes += item.minutes;
    e.grossCents += item.amountCents;
    if (item.isCarryOver) { e.carryMinutes += item.minutes; e.carryCents += item.amountCents; }
    if (item.kind === "ADJUSTMENT") e.hints.push(`Nachträgliche Korrektur ${de(s.workDate)}: ${open > 0 ? "+" : ""}${open} Min. gegenüber der früheren Abrechnung`);
  }
  return [...byEmp.values()].filter((e) => e.items.length || e.blockers.length || e.hints.length);
}

/** Zahlungsstatus aus Bruttobetrag und gebuchten Zahlungen (Stornos sind negative Zahlungen) */
export function paymentStatus(grossCents: number, paidCents: number, settled: boolean): "PREPARED" | "SETTLED" | "PARTIALLY_PAID" | "PAID" {
  if (paidCents >= grossCents && grossCents > 0) return "PAID";
  if (paidCents > 0) return "PARTIALLY_PAID";
  return settled ? "SETTLED" : "PREPARED";
}

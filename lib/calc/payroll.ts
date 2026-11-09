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

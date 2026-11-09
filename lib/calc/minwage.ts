// Gesetzlicher Mindestlohn (brutto je Stunde, in Cent). Quelle: Mindestlohnanpassungsverordnungen.
// Neue Werte hier ergänzen, sobald die Bundesregierung sie beschließt.
const TABLE: [string, number][] = [
  ["2024-01-01", 1241],
  ["2025-01-01", 1282],
  ["2026-01-01", 1390],
  ["2027-01-01", 1460],
];

export function minimumWageCents(date: string): number {
  let v = 0;
  for (const [from, c] of TABLE) if (from <= date) v = c;
  return v;
}

export interface WageRow { validFrom: string; validTo: string | null; centsPerHour: number }
export interface WageIssue { date: string; cents: number; minimum: number; future: boolean }

/** Prüft den Lohn heute und an jedem späteren Stichtag (Mindestlohn-Erhöhung oder geplanter Lohnwechsel) */
export function wageIssues(wages: WageRow[], today: string): WageIssue[] {
  const points = [...new Set([today, ...TABLE.map(([d]) => d), ...wages.map((w) => w.validFrom)])].filter((d) => d >= today).sort();
  const out: WageIssue[] = [];
  for (const d of points) {
    const w = wages.find((x) => x.validFrom <= d && (!x.validTo || x.validTo >= d));
    if (!w) continue;
    const min = minimumWageCents(d);
    if (w.centsPerHour < min && !out.some((o) => o.cents === w.centsPerHour && o.minimum === min)) out.push({ date: d, cents: w.centsPerHour, minimum: min, future: d > today });
  }
  return out;
}

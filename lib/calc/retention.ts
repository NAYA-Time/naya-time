// Aufbewahrung ehemaliger Mitarbeiter (Gunnar 09.11.2026: nie automatisch löschen, nur erinnern + Knopf).
// Arbeitszeitnachweise: mind. 2 Jahre (§ 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG).
// Wurden über NAYA TIME Löhne abgerechnet/ausgezahlt (Aushilfen), zur Sicherheit 6 Jahre (Lohnunterlagen, § 41 EStG).
// Gezählt wird ab Ende des Kalenderjahres, in dem der Mitarbeiter ausgeschieden ist.

export interface RetentionInput { exitDate: string | null; lastActivity: string | null; createdAt: string; hasPayroll: boolean }
export interface Retention { reference: string; years: number; deletableFrom: string; reason: string }

/** Alle Daten als "YYYY-MM-DD" */
export function retentionFor(i: RetentionInput): Retention {
  const known = [i.exitDate, i.lastActivity].filter((x): x is string => !!x).sort();
  const reference = known.at(-1) ?? i.createdAt; // Anlagedatum nur, wenn es weder Austritt noch Buchungen gibt
  const years = i.hasPayroll ? 6 : 2;
  const deletableFrom = `${Number(reference.slice(0, 4)) + years + 1}-01-01`;
  const reason = i.hasPayroll ? "6 Jahre, weil Löhne über NAYA TIME abgerechnet wurden (Lohnunterlagen)" : "2 Jahre (Arbeitszeitnachweise nach ArbZG und Mindestlohngesetz)";
  return { reference, years, deletableFrom, reason };
}

export const isDeletable = (r: Retention, today: string) => today >= r.deletableFrom;

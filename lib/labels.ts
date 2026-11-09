export const EMPLOYMENT_LABEL: Record<string, string> = {
  FESTANGESTELLT: "Festangestellt", MINIJOB: "Minijob", KURZFRISTIG: "Kurzfristige Beschäftigung",
  TEILZEIT_STUNDENLOHN: "Teilzeit auf Stundenlohnbasis", SONSTIGE_AUSHILFE: "Sonstige Aushilfe",
};
export const METHOD_LABEL: Record<string, string> = {
  WEEKLY_AVERAGE: "Durchschnitt (Woche × 13 ÷ 3)", CALENDAR_EXACT: "Kalendergenau", FIXED_MONTHLY: "Feste Monatsstunden",
};
export const euro = (cents: number) => (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const dateDe = (d: Date | null | undefined) => (d ? d.toLocaleDateString("de-DE", { timeZone: "UTC" }) : "–");

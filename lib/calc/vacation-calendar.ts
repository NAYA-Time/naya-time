// Urlaubsübersicht (Gunnar 09.11.2026): Kalender je Abteilung und gesamt, Überschneidungen, Monat und Jahr.
export type DeptKey = "KUECHE" | "SERVICE" | "SPUELE" | "BUERO" | "OTHER";
export const DEPT_LABEL: Record<DeptKey, string> = { KUECHE: "Küche", SERVICE: "Service", SPUELE: "Spülküche", BUERO: "Büro", OTHER: "Sonstige" };
export const DEPT_ORDER: DeptKey[] = ["KUECHE", "SERVICE", "SPUELE", "BUERO", "OTHER"];
export type Mark = "U" | "A"; // U = Urlaub eingetragen/genehmigt, A = Antrag offen

export interface CalEmployee { id: string; name: string; dept: DeptKey }
export interface CalEntry { employeeId: string; from: string; to: string; kind: Mark; days?: { date: string; value: number }[] }

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
export const isWeekend = (ymd: string) => [0, 6].includes(new Date(ymd + "T12:00:00Z").getUTCDay());

export interface CalRow { emp: CalEmployee; cells: Record<string, Mark | undefined>; vacDays: number; requestedDays: number }
export interface Overlap { from: string; to: string; dept: DeptKey; names: string[] }
export interface Calendar { days: string[]; groups: { dept: DeptKey; rows: CalRow[]; count: Record<string, number> }[]; total: Record<string, number>; overlaps: Overlap[] }

/**
 * Baut den Kalender für einen Zeitraum. Urlaubstage zählen nach Anrechnung (halbe Tage möglich),
 * offene Anträge als Kalendertage. Überschneidung = mindestens 2 Personen derselben Abteilung am selben Tag
 * (Anträge zählen mit, damit man vor dem Genehmigen sieht, wer gleichzeitig fehlt).
 */
export function buildCalendar(emps: CalEmployee[], entries: CalEntry[], from: string, to: string): Calendar {
  const days = daysOf(from, to);
  const rows = new Map<string, CalRow>(emps.map((e) => [e.id, { emp: e, cells: {}, vacDays: 0, requestedDays: 0 }]));
  for (const en of entries) {
    const r = rows.get(en.employeeId);
    if (!r) continue;
    for (const d of daysOf(en.from < from ? from : en.from, en.to > to ? to : en.to)) {
      if (r.cells[d] === "U") continue; // eingetragener Urlaub geht vor Antrag
      r.cells[d] = en.kind;
      if (en.kind === "A") r.requestedDays++;
    }
    if (en.kind === "U") r.vacDays += (en.days ?? []).filter((x) => x.date >= from && x.date <= to).reduce((a, x) => a + x.value, 0) / 2;
  }
  const groups = DEPT_ORDER.map((dept) => {
    const rs = [...rows.values()].filter((r) => r.emp.dept === dept).sort((a, b) => a.emp.name.localeCompare(b.emp.name, "de"));
    const count = Object.fromEntries(days.map((d) => [d, rs.filter((r) => r.cells[d]).length]));
    return { dept, rows: rs, count };
  }).filter((g) => g.rows.length);
  const total = Object.fromEntries(days.map((d) => [d, groups.reduce((a, g) => a + g.count[d], 0)]));

  // zusammenhängende Tage mit derselben Personengruppe zu einem Zeitraum zusammenfassen
  const overlaps: Overlap[] = [];
  for (const g of groups) {
    let cur: Overlap | null = null;
    for (const d of days) {
      const names = g.rows.filter((r) => r.cells[d]).map((r) => r.emp.name + (r.cells[d] === "A" ? " (Antrag)" : ""));
      const key = names.join("|");
      if (names.length >= 2 && cur && cur.names.join("|") === key && addDays(cur.to, 1) === d) cur.to = d;
      else {
        if (cur) overlaps.push(cur);
        cur = names.length >= 2 ? { from: d, to: d, dept: g.dept, names } : null;
      }
    }
    if (cur) overlaps.push(cur);
  }
  overlaps.sort((a, b) => a.from.localeCompare(b.from));
  return { days, groups, total, overlaps };
}

/** Jahresübersicht: Urlaubstage je Mitarbeiter und Monat */
export function yearTable(emps: CalEmployee[], entries: CalEntry[], year: number) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const perMonth = months.map((m) => buildCalendar(emps, entries, monthRange(m).from, monthRange(m).to));
  const full = buildCalendar(emps, entries, `${year}-01-01`, `${year}-12-31`);
  const groups = full.groups.map((g) => ({
    dept: g.dept,
    rows: g.rows.map((r) => ({
      emp: r.emp,
      months: perMonth.map((c) => { const row = c.groups.find((x) => x.dept === g.dept)?.rows.find((x) => x.emp.id === r.emp.id); return { vac: row?.vacDays ?? 0, req: row?.requestedDays ?? 0 }; }),
      vacDays: r.vacDays, requestedDays: r.requestedDays,
    })),
  }));
  return { months, groups, overlaps: full.overlaps };
}

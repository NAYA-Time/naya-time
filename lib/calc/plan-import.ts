// Dienstplan-Foto: ausgelesene Tabelle → Vorschlag für die Prüftabelle (rein, ohne Datenbank, direkt testbar).
// Das Auslesen selbst macht lib/plan-photo.ts. Hier: Namen zuordnen, Zeiten prüfen, Datum auf die Woche legen.

export type CellKind = "WORK" | "OFF" | "VACATION" | "SICK" | "UNCLEAR";
export interface ExtractedDay { date: string | null; weekday: number; kind: CellKind; start: string | null; end: string | null; raw: string }
export interface ExtractedRow { name: string; days: ExtractedDay[] }
export interface ExtractedPlan { weekStart: string | null; department: string | null; rows: ExtractedRow[] }

export interface PlanEmployee { id: string; firstName: string; lastName: string; displayName: string }
export interface ProposalCell { date: string; kind: CellKind; start: string | null; end: string | null; raw: string; existing: string | null }
export interface ProposalRow { name: string; employeeId: string | null; matchNote: string | null; cells: ProposalCell[] }
export interface Proposal { monday: string; department: string | null; rows: ProposalRow[]; notes: string[] }

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const mondayOfYmd = (ymd: string) => addDays(ymd, -((new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7));

/** Name vereinfachen: Groß/klein, Akzente (ş → s), Punkte und Leerzeichen egal */
export function normName(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Uhrzeit aus "13:30", "13.30", "1330", "9", "9:00" → "HH:MM"; sonst null */
export function normTime(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})(?:[:.,h]?(\d{2}))?(?:\s*uhr)?$/i);
  if (!m) return null;
  const h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return `${String(h % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Name im Plan einem Mitarbeiter zuordnen: Vorname, Anzeigename, Nachname oder "Vorname N." – nur eindeutige Treffer */
export function matchEmployee(name: string, emps: PlanEmployee[]): { id: string | null; note: string | null } {
  const n = normName(name);
  if (!n) return { id: null, note: "Kein Name erkannt" };
  const tests: ((e: PlanEmployee) => boolean)[] = [
    (e) => normName(`${e.firstName} ${e.lastName}`) === n || normName(e.displayName) === n,
    (e) => normName(e.firstName) === n,
    (e) => normName(e.lastName) === n,
    (e) => { const [f, l] = n.split(" "); return !!l && normName(e.firstName) === f && normName(e.lastName).startsWith(l); },
  ];
  for (const t of tests) {
    const hits = emps.filter(t);
    if (hits.length === 1) return { id: hits[0].id, note: null };
    if (hits.length > 1) return { id: null, note: `Mehrdeutig (${hits.map((e) => `${e.firstName} ${e.lastName}`).join(", ")}) – bitte auswählen` };
  }
  return { id: null, note: "Nicht gefunden – bitte auswählen oder Zeile weglassen" };
}

/**
 * Vorschlag bauen. monday: die Woche, die im Backoffice gerade offen ist (wird genommen, wenn das Foto kein Datum zeigt).
 * existing: schon vorhandene Dienste je "employeeId|datum" als Text (z. B. "15:00–23:30"), damit nichts doppelt angelegt wird.
 */
export function buildProposal(plan: ExtractedPlan, emps: PlanEmployee[], fallbackMonday: string, existing: Map<string, string>): Proposal {
  const notes: string[] = [];
  let monday = fallbackMonday;
  if (isYmd(plan.weekStart)) {
    monday = mondayOfYmd(plan.weekStart);
    if (monday !== fallbackMonday) notes.push(`Das Foto zeigt die Woche ab ${monday.split("-").reverse().join(".")}. Diese Woche wird verwendet.`);
  } else notes.push("Auf dem Foto ist kein Datum erkennbar. Es wird die gerade geöffnete Woche verwendet.");
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const used = new Set<string>();
  const rows: ProposalRow[] = plan.rows.filter((r) => r.name.trim()).map((r) => {
    const m = matchEmployee(r.name, emps);
    let id = m.id, note = m.note;
    if (id && used.has(id)) { note = "Steht doppelt im Plan – bitte prüfen"; id = null; }
    if (id) used.add(id);
    const cells = days.map((date, i): ProposalCell => {
      const d = r.days.find((x) => x.date === date) ?? r.days.find((x) => x.weekday === i + 1);
      const ex = id ? existing.get(`${id}|${date}`) ?? null : null;
      if (!d) return { date, kind: "OFF", start: null, end: null, raw: "", existing: ex };
      const start = normTime(d.start), end = normTime(d.end);
      let kind = d.kind;
      if (kind === "WORK" && !start) kind = "UNCLEAR"; // Dienst ohne lesbare Uhrzeit nie raten
      return { date, kind, start: kind === "WORK" ? start : null, end: kind === "WORK" ? end : null, raw: d.raw ?? "", existing: ex };
    });
    return { name: r.name.trim(), employeeId: id, matchNote: note, cells };
  });
  if (!rows.length) notes.push("Es wurden keine Zeilen mit Namen erkannt.");
  return { monday, department: plan.department, rows, notes };
}

/** Was nach der Prüfung gespeichert wird: nur Dienste mit Uhrzeit und zugeordnetem Mitarbeiter */
export interface ConfirmedShift { employeeId: string; date: string; start: string; end: string | null }
export function shiftsToSave(rows: { employeeId: string | null; cells: { date: string; kind: CellKind; start: string | null; end: string | null }[] }[]): ConfirmedShift[] {
  const out: ConfirmedShift[] = [];
  for (const r of rows) {
    if (!r.employeeId) continue;
    for (const c of r.cells) {
      const start = normTime(c.start);
      if (c.kind !== "WORK" || !start || !isYmd(c.date)) continue;
      out.push({ employeeId: r.employeeId, date: c.date, start, end: normTime(c.end) });
    }
  }
  return out;
}

import { amount } from "../calc/payroll";
// Excel-Berichte (Woche, Monat, Aushilfenlauf). Zeiten als Excel-Zeitwerte ([h]:mm), damit man in Excel weiterrechnen kann.
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { FILTER_LABEL as DEPT_LABEL, matchesEmp, matchesFilter, type DeptFilter } from "../dept";
import { loadMonth } from "../month-data";
import { sickCounts } from "../sick";
import { monthBounds } from "../calc/month";
import { berlinDate, berlinTime, dbDate } from "../time";

const ABS_LABEL: Record<string, string> = { VACATION: "Urlaub", SICK: "Krank", SICK_CHILD: "Kind krank", SPECIAL_LEAVE: "Sonderurlaub", UNPAID: "Unbezahlt", TIME_OFF_IN_LIEU: "Freizeitausgleich" };
const FINDING_LABEL: Record<string, string> = { LATE: "Verspätung", LATE_START: "Verspätung", LATE_END: "Länger als geplant", EARLY_START: "Früher gekommen", NO_SHOW: "Nicht erschienen", OFFLINE_UNTRUSTED: "Offline-Zeit unsicher", OFFLINE_REJECTED: "Offline-Buchung abgelehnt", MISSING_CLOCK_OUT: "Ausstempeln fehlt", BREAK_MISSING: "Pause fehlt", MAX_HOURS: "Höchstarbeitszeit", REST_PERIOD: "Ruhezeit", PHOTO_MISSING: "Foto fehlt", OVERRUN: "Länger als geplant", EARLY: "Früher gekommen" };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const de = (s: string) => `${s.slice(8)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const t = (min: number) => min / 1440; // Minuten → Excel-Tagesbruchteil
const TIME_FMT = "[h]:mm;-[h]:mm";
const EURO_FMT = '#,##0.00 "€"';

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number; time?: boolean; euro?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14, style: c.time ? { numFmt: TIME_FMT } : c.euro ? { numFmt: EURO_FMT } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A2D33" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}
const meta = (wb: ExcelJS.Workbook) => { wb.creator = "NAYA TIME"; wb.created = new Date(); };

async function rangeData(db: PrismaClient, from: string, to: string, filter: DeptFilter) {
  const range = { gte: dbDate(from), lte: dbDate(to) };
  const [emps, sessions, shifts, absDays, findings] = await Promise.all([
    db.employee.findMany({ include: { primaryDept: { include: { parent: true } }, contracts: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    db.workSession.findMany({ where: { workDate: range }, include: { clockInEvent: true, clockOutEvent: true, department: { include: { parent: true } } }, orderBy: [{ workDate: "asc" }] }),
    db.scheduledShift.findMany({ where: { workDate: range, deletedAt: null, kind: "WORK" }, include: { department: { include: { parent: true } } } }),
    db.absenceDay.findMany({ where: { date: range, absence: { status: { not: "CANCELLED" } } }, include: { absence: true } }),
    db.complianceFinding.findMany({ where: { workDate: range }, orderBy: { workDate: "asc" } }),
  ]);
  const visible = emps.filter((e) => matchesEmp(filter, e) || sessions.some((s) => s.employeeId === e.id && matchesFilter(filter, s.department)));
  const ids = new Set(visible.map((e) => e.id));
  return {
    emps: visible, empById: new Map(emps.map((e) => [e.id, e])),
    sessions: sessions.filter((s) => ids.has(s.employeeId)), shifts: shifts.filter((s) => ids.has(s.employeeId)),
    absDays: absDays.filter((a) => ids.has(a.absence.employeeId)), findings: findings.filter((f) => ids.has(f.employeeId)),
  };
}
type Data = Awaited<ReturnType<typeof rangeData>>;
const contractAt = (e: Data["emps"][number], d: string) => e.contracts.find((c) => ymd(c.validFrom) <= d && (!c.validTo || ymd(c.validTo) >= d));
const net = (s: { startAt: Date | null; endAt: Date | null; plannedBreakMinutes: number }) => (s.startAt && s.endAt ? Math.max(0, Math.round((s.endAt.getTime() - s.startAt.getTime()) / 60000) - s.plannedBreakMinutes) : 0);

function daySheets(wb: ExcelJS.Workbook, d: Data) {
  const days = sheet(wb, "Tage", [
    { header: "Datum", key: "date", width: 12 }, { header: "Mitarbeiter", key: "name", width: 22 }, { header: "Abteilung", key: "dept" },
    { header: "Dienst geplant", key: "planned", width: 16 }, { header: "Kommen", key: "in", width: 10 }, { header: "Gehen", key: "out", width: 10 },
    { header: "Pause", key: "brk", time: true, width: 9 }, { header: "Arbeitszeit", key: "worked", time: true }, { header: "Vergütet", key: "payable", time: true },
    { header: "Status", key: "status", width: 14 }, { header: "Hinweise", key: "notes", width: 40 },
  ]);
  for (const s of d.sessions) {
    const e = d.empById.get(s.employeeId)!;
    const notes = [s.lateMinutes > 5 && `${s.lateMinutes} Min. später`, s.overrunMinutes > 0 && `${s.overrunMinutes} Min. länger als geplant`, s.earlyArrivalMinutes > 0 && `${s.earlyArrivalMinutes} Min. früher da`].filter(Boolean).join(", ");
    days.addRow({
      date: de(ymd(s.workDate)), name: `${e.lastName}, ${e.firstName}`, dept: s.department.name,
      planned: s.plannedStartAt && s.plannedEndAt ? `${berlinTime(s.plannedStartAt)}–${berlinTime(s.plannedEndAt)}` : "ohne Plan",
      in: s.clockInEvent ? berlinTime(s.clockInEvent.effectiveAt) : s.effectiveStartAt ? `${berlinTime(s.effectiveStartAt)} (nachgetragen)` : "–", out: s.clockOutEvent ? berlinTime(s.clockOutEvent.effectiveAt) : !s.clockInEvent && s.effectiveEndAt ? berlinTime(s.effectiveEndAt) : "–",
      brk: t(s.breakMinutes), worked: t(s.workedMinutes), payable: t(s.payableMinutes),
      status: s.status === "CLOSED" ? "abgeschlossen" : s.status === "OPEN" ? "eingestempelt" : "Ausstempeln fehlt", notes,
    });
  }
  const abs = sheet(wb, "Abwesenheiten", [{ header: "Datum", key: "date", width: 12 }, { header: "Mitarbeiter", key: "name", width: 22 }, { header: "Art", key: "type" }, { header: "Angerechnet", key: "credit", time: true }, { header: "Urlaubstage", key: "vac" }]);
  for (const a of [...d.absDays].sort((x, y) => x.date.getTime() - y.date.getTime())) {
    const e = d.empById.get(a.absence.employeeId)!;
    abs.addRow({ date: de(ymd(a.date)), name: `${e.lastName}, ${e.firstName}`, type: ABS_LABEL[a.absence.type], credit: t(a.creditedMinutes), vac: a.vacationDayValue / 2 });
  }
  const hints = sheet(wb, "Hinweise", [{ header: "Datum", key: "date", width: 12 }, { header: "Mitarbeiter", key: "name", width: 22 }, { header: "Art", key: "code", width: 20 }, { header: "Gesetzlich", key: "legal", width: 11 }, { header: "Hinweis", key: "msg", width: 60 }, { header: "Status", key: "status" }]);
  for (const f of d.findings) {
    const e = d.empById.get(f.employeeId)!;
    hints.addRow({ date: de(ymd(f.workDate)), name: `${e.lastName}, ${e.firstName}`, code: FINDING_LABEL[f.code] ?? f.code, legal: f.isLegal ? "ja" : "nein", msg: f.message, status: f.status === "OPEN" ? "offen" : "geprüft" });
  }
}

export async function weeklyReport(db: PrismaClient, monday: string, filter: DeptFilter) {
  const sunday = ymd(new Date(Date.parse(monday + "T00:00:00Z") + 6 * 86400000));
  const d = await rangeData(db, monday, sunday, filter);
  const wb = new ExcelJS.Workbook();
  meta(wb);
  const ov = sheet(wb, "Übersicht", [
    { header: "Mitarbeiter", key: "name", width: 22 }, { header: "Abteilung", key: "dept" }, { header: "Art", key: "kind", width: 12 },
    { header: "Soll Woche", key: "target", time: true }, { header: "Geplant", key: "planned", time: true }, { header: "Gearbeitet (vergütet)", key: "worked", time: true, width: 20 },
    { header: "Krank", key: "sick", time: true }, { header: "Urlaub/Sonst.", key: "vac", time: true }, { header: "Ist gesamt", key: "actual", time: true }, { header: "Ist − Plan", key: "diff", time: true }, { header: "Hinweise", key: "hints", width: 10 },
  ]);
  for (const e of d.emps) {
    const c = contractAt(e, monday) ?? contractAt(e, sunday);
    if (!c && !d.sessions.some((s) => s.employeeId === e.id)) continue;
    const worked = d.sessions.filter((s) => s.employeeId === e.id && s.status === "CLOSED").reduce((a, s) => a + s.payableMinutes, 0);
    const planned = d.shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + net(s), 0);
    const abs = d.absDays.filter((a) => a.absence.employeeId === e.id);
    const sick = abs.filter((a) => a.absence.type.startsWith("SICK")).reduce((x, a) => x + a.creditedMinutes, 0);
    const vac = abs.filter((a) => !a.absence.type.startsWith("SICK")).reduce((x, a) => x + a.creditedMinutes, 0);
    ov.addRow({
      name: `${e.lastName}, ${e.firstName}`, dept: e.primaryDept.name, kind: c?.payModel === "HOURLY" ? "Aushilfe" : "Fest",
      target: c?.payModel === "SALARIED" && c.weeklyMinutes ? t(c.weeklyMinutes) : null, planned: t(planned), worked: t(worked),
      sick: t(sick), vac: t(vac), actual: t(worked + sick + vac), diff: t(worked + sick + vac - planned), hints: d.findings.filter((f) => f.employeeId === e.id).length,
    });
  }
  daySheets(wb, d);
  return { wb, fileName: `NAYA-TIME_Woche_${monday}_${DEPT_LABEL[filter]}.xlsx`, periodStart: monday, periodEnd: sunday };
}

export async function monthlyReport(db: PrismaClient, month: string, filter: DeptFilter) {
  const { first, last } = monthBounds(month);
  const d = await rangeData(db, first, last, filter);
  const closings = await db.monthlyTimeClosing.findMany({ where: { month: dbDate(first), status: "CLOSED" } });
  const wb = new ExcelJS.Workbook();
  meta(wb);
  const fest = sheet(wb, "Festangestellte", [
    { header: "Mitarbeiter", key: "name", width: 22 }, { header: "Abteilung", key: "dept" }, { header: "Soll", key: "target", time: true }, { header: "Gearbeitet", key: "worked", time: true },
    { header: "Krank", key: "sick", time: true }, { header: "Urlaub", key: "vac", time: true }, { header: "Feiertag", key: "hol", time: true }, { header: "Sonstiges", key: "other", time: true },
    { header: "Ist gesamt", key: "actual", time: true }, { header: "Differenz", key: "diff", time: true }, { header: "Davon abgegolten", key: "incl", time: true, width: 16 },
    { header: "Aus Vormonaten", key: "before", time: true, width: 15 }, { header: "Aufs Konto", key: "change", time: true }, { header: "Neuer Stand", key: "after", time: true }, { header: "Status", key: "status", width: 16 },
  ]);
  const aus = sheet(wb, "Aushilfen", [
    { header: "Mitarbeiter", key: "name", width: 22 }, { header: "Abteilung", key: "dept" }, { header: "Stunden (vergütet)", key: "hours", time: true, width: 18 },
    { header: "Bezahlte Abwesenheit", key: "abs", time: true, width: 20 }, { header: "Brutto (rechnerisch)", key: "gross", euro: true, width: 20 }, { header: "Hinweis", key: "note", width: 50 },
  ]);
  for (const e of d.emps) {
    const c = contractAt(e, last) ?? contractAt(e, first);
    if (!c) continue;
    if (c.payModel === "SALARIED") {
      const closing = closings.find((x) => x.employeeId === e.id);
      const r = await loadMonth(db, e.id, month);
      const v = closing
        ? { target: closing.targetMinutes, worked: closing.workedMinutes, sick: closing.sickCreditMinutes, vac: closing.vacationCreditMinutes, hol: closing.holidayCreditMinutes, other: closing.otherCreditMinutes, incl: closing.includedOvertimeMinutes, before: closing.balanceBeforeMinutes, change: closing.accountChangeMinutes, after: closing.balanceAfterMinutes }
        : { target: r.target, worked: r.worked, sick: r.sick, vac: r.vacation, hol: r.holiday, other: r.other, incl: r.included, before: r.balanceBefore, change: r.accountChange, after: r.balanceAfter };
      const actual = v.worked + v.sick + v.vac + v.hol + v.other;
      fest.addRow({ name: `${e.lastName}, ${e.firstName}`, dept: e.primaryDept.name, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, t(x)])), actual: t(actual), diff: t(actual - v.target), status: closing ? `abgeschlossen${closing.version > 1 ? ` (V${closing.version})` : ""}` : "vorläufig" });
    } else {
      const wages = await db.hourlyWageHistory.findMany({ where: { employeeId: e.id } });
      const rate = (day: string) => wages.find((w) => ymd(w.validFrom) <= day && (!w.validTo || ymd(w.validTo) >= day))?.centsPerHour ?? 0;
      const ss = d.sessions.filter((s) => s.employeeId === e.id && s.status === "CLOSED");
      const ab = d.absDays.filter((a) => a.absence.employeeId === e.id && ["SICK", "VACATION", "SPECIAL_LEAVE"].includes(a.absence.type));
      // je Tag auf Cent gerundet – genau wie die Aushilfenabrechnung (lib/calc/payroll.ts), damit beide Beträge übereinstimmen
      const gross = [...ss.map((s) => amount(s.payableMinutes, rate(ymd(s.workDate)))), ...ab.map((a) => amount(a.creditedMinutes, rate(ymd(a.date))))].reduce((x, y) => x + y, 0);
      const open = d.sessions.filter((s) => s.employeeId === e.id && s.status !== "CLOSED").length;
      aus.addRow({ name: `${e.lastName}, ${e.firstName}`, dept: e.primaryDept.name, hours: t(ss.reduce((a, s) => a + s.payableMinutes, 0)), abs: t(ab.reduce((a, x) => a + x.creditedMinutes, 0)), gross: gross / 100, note: open ? `${open} Schicht(en) ohne Ausstempeln nicht enthalten` : "Ausgezahlt wird über die Aushilfenabrechnung (Stichtag)" });
    }
  }
  daySheets(wb, d);
  return { wb, fileName: `NAYA-TIME_Monat_${month}_${DEPT_LABEL[filter]}.xlsx`, periodStart: first, periodEnd: last };
}

export async function payrollReport(db: PrismaClient, periodId: string) {
  const p = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId }, include: { settlements: { include: { employee: true, items: { orderBy: { workDate: "asc" } }, payments: true } } } });
  const wb = new ExcelJS.Workbook();
  meta(wb);
  const sum = sheet(wb, "Abrechnung", [{ header: "Mitarbeiter", key: "name", width: 22 }, { header: "Stunden", key: "hours", time: true }, { header: "Davon Übertrag", key: "carry", time: true, width: 15 }, { header: "Brutto", key: "gross", euro: true }, { header: "Ausgezahlt", key: "paid", euro: true }, { header: "Status", key: "status", width: 18 }]);
  const items = sheet(wb, "Positionen", [{ header: "Mitarbeiter", key: "name", width: 22 }, { header: "Tag", key: "date", width: 12 }, { header: "Art", key: "kind", width: 18 }, { header: "Stunden", key: "hours", time: true }, { header: "Lohn/Std.", key: "rate", euro: true }, { header: "Betrag", key: "amount", euro: true }, { header: "Übertrag", key: "carry", width: 10 }]);
  const KIND: Record<string, string> = { WORK: "Arbeit", PAID_ABSENCE: "Bezahlte Abwesenheit", ADJUSTMENT: "Korrektur" };
  const STATUS: Record<string, string> = { PREPARED: "vorbereitet", SETTLED: "abgerechnet", PARTIALLY_PAID: "teilweise bezahlt", PAID: "bezahlt", PAYMENT_SCHEDULED: "Auszahlung vorgemerkt", NEEDS_CORRECTION: "Korrektur nötig", NOT_SETTLED: "offen" };
  for (const s of p.settlements) {
    const name = `${s.employee.lastName}, ${s.employee.firstName}`;
    sum.addRow({ name, hours: t(s.minutes), carry: t(s.items.filter((i) => i.isCarryOver).reduce((a, i) => a + i.minutes, 0)), gross: s.grossCents / 100, paid: s.payments.filter((x) => !x.reversedById).reduce((a, x) => a + x.amountCents, 0) / 100, status: STATUS[s.status] });
    for (const i of s.items) items.addRow({ name, date: de(ymd(i.workDate)), kind: KIND[i.kind], hours: t(i.minutes), rate: i.centsPerHour / 100, amount: i.amountCents / 100, carry: i.isCarryOver ? "ja" : "" });
  }
  const stamp = ymd(p.cutoffDate);
  return { wb, fileName: `NAYA-TIME_Aushilfen_bis_${stamp}.xlsx`, periodStart: stamp, periodEnd: stamp };
}

export const today = () => berlinDate(new Date());

const CERT_LABEL: Record<string, string> = { UNKNOWN: "noch offen", EAU_RETRIEVED: "eAU abgerufen", SUBMITTED: "vorgelegt", NOT_REQUIRED: "nicht erforderlich" };

/** Krankheitsliste für einen Zeitraum, nach Mitarbeitern sortiert (ohne Diagnosen – die werden nie gespeichert) */
export async function sickReport(db: PrismaClient, from: string, to: string, filter: DeptFilter) {
  const absences = await db.absence.findMany({
    where: { type: { in: ["SICK", "SICK_CHILD"] }, status: { not: "CANCELLED" }, startDate: { lte: dbDate(to) }, endDate: { gte: dbDate(from) } },
    include: { employee: { include: { primaryDept: { include: { parent: true } } } }, days: true, sickLeave: true },
  });
  const rows = absences
    .filter((a) => matchesEmp(filter, a.employee))
    .sort((a, b) => a.employee.lastName.localeCompare(b.employee.lastName, "de") || a.employee.firstName.localeCompare(b.employee.firstName, "de") || a.startDate.getTime() - b.startDate.getTime());
  const wb = new ExcelJS.Workbook();
  meta(wb);
  const sum = sheet(wb, "Nach Mitarbeitern", [
    { header: "Mitarbeiter", key: "name", width: 24 }, { header: "Abteilung", key: "dept" }, { header: "Krankmeldungen", key: "count", width: 16 },
    { header: "Krankheitstage", key: "sickDays", width: 15 }, { header: "davon Kind krank", key: "childDays", width: 16 }, { header: "Angerechnet", key: "credit", time: true }, { header: "AU offen", key: "open", width: 10 },
    { header: "Krank im lfd. Jahr", key: "yearDays", width: 17 }, { header: "Krank seit Eintritt", key: "totalDays", width: 18 }, { header: "Eintritt", key: "entry", width: 12 },
  ]);
  const counts = await sickCounts([...new Set(rows.map((a) => a.employeeId))], to);
  const list = sheet(wb, "Einzelne Krankmeldungen", [
    { header: "Mitarbeiter", key: "name", width: 24 }, { header: "Abteilung", key: "dept" }, { header: "Art", key: "type", width: 12 }, { header: "Von", key: "from", width: 12 },
    { header: "Bis", key: "to", width: 12 }, { header: "Tage im Zeitraum", key: "days", width: 16 }, { header: "Angerechnet", key: "credit", time: true }, { header: "AU-Bescheinigung", key: "cert", width: 18 },
  ]);
  // Kalendertage innerhalb des gewählten Zeitraums (eine Krankmeldung kann über den Zeitraum hinausgehen)
  const daysIn = (a: (typeof rows)[number]) => {
    const s = Math.max(Date.parse(ymd(a.startDate)), Date.parse(from)), e = Math.min(Date.parse(ymd(a.endDate)), Date.parse(to));
    return Math.max(0, Math.round((e - s) / 86400000) + 1);
  };
  const creditIn = (a: (typeof rows)[number]) => a.days.filter((d) => ymd(d.date) >= from && ymd(d.date) <= to).reduce((x, d) => x + d.creditedMinutes, 0);
  const byEmp = new Map<string, typeof rows>();
  for (const a of rows) byEmp.set(a.employeeId, [...(byEmp.get(a.employeeId) ?? []), a]);
  for (const [, as] of byEmp) {
    const e = as[0].employee;
    sum.addRow({
      name: `${e.lastName}, ${e.firstName}`, dept: e.primaryDept.name, count: as.length,
      sickDays: as.filter((a) => a.type === "SICK").reduce((x, a) => x + daysIn(a), 0), childDays: as.filter((a) => a.type === "SICK_CHILD").reduce((x, a) => x + daysIn(a), 0),
      credit: t(as.reduce((x, a) => x + creditIn(a), 0)), open: as.filter((a) => a.type === "SICK" && (a.sickLeave?.certificateStatus ?? "UNKNOWN") === "UNKNOWN").length,
      yearDays: counts.get(e.id)?.sickYear ?? 0, totalDays: counts.get(e.id)?.sickTotal ?? 0, entry: de(ymd(e.entryDate)),
    });
    for (const a of as) list.addRow({ name: `${e.lastName}, ${e.firstName}`, dept: e.primaryDept.name, type: ABS_LABEL[a.type], from: de(ymd(a.startDate)), to: de(ymd(a.endDate)), days: daysIn(a), credit: t(creditIn(a)), cert: a.type === "SICK" ? CERT_LABEL[a.sickLeave?.certificateStatus ?? "UNKNOWN"] ?? "–" : "–" });
  }
  if (!rows.length) sum.addRow({ name: "Keine Krankmeldungen in diesem Zeitraum" });
  return { wb, fileName: `NAYA-TIME_Krankheit_${from}_bis_${to}_${DEPT_LABEL[filter]}.xlsx`, periodStart: from, periodEnd: to, count: rows.length };
}

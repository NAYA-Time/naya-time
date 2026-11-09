// Urlaubsübersicht als PDF (A4 quer): Monat mit Kalender je Abteilung + Gesamt, Jahr mit Tagen je Monat.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { DEPT_LABEL, isWeekend, type Calendar, type CalRow, type DeptKey, type Overlap, type yearTable } from "../calc/vacation-calendar";

const W = 842, H = 595, M = 28;
const C = { ink: rgb(0.1, 0.1, 0.12), mute: rgb(0.45, 0.47, 0.5), line: rgb(0.82, 0.82, 0.84), wk: rgb(0.93, 0.93, 0.95), gold: rgb(0.78, 0.63, 0.36), bad: rgb(0.85, 0.33, 0.28), warn: rgb(0.89, 0.65, 0.3) };
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const de = (ymd: string) => `${ymd.slice(8)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
const num = (n: number) => (n ? n.toLocaleString("de-DE") : "–");

class Doc {
  page!: PDFPage; y = 0; n = 0;
  constructor(public pdf: PDFDocument, public f: PDFFont, public b: PDFFont, public title: string, public stand: string) {}
  newPage() {
    this.page = this.pdf.addPage([W, H]); this.n++;
    this.text("NAYA TIME · " + this.title, M, H - M - 4, 13, this.b);
    this.text(`Stand ${this.stand} · Seite ${this.n}`, W - M - 150, H - M - 4, 8, this.f, C.mute);
    this.y = H - M - 26;
  }
  need(h: number) { if (this.y - h < M) this.newPage(); }
  text(t: string, x: number, y: number, size = 8, font = this.f, color = C.ink) { this.page.drawText(t, { x, y, size, font, color }); }
  fit(t: string, w: number, size = 8) { let s = t; while (s.length > 1 && this.f.widthOfTextAtSize(s, size) > w) s = s.slice(0, -2) + "…"; return s; }
}

function legend(d: Doc) {
  d.need(16);
  let x = M; const y = d.y - 8;
  const item = (draw: () => void, t: string) => { draw(); d.text(t, x + 18, y, 8, d.f, C.mute); x += 30 + d.f.widthOfTextAtSize(t, 8); };
  item(() => d.page.drawRectangle({ x, y: y - 2, width: 14, height: 9, color: C.gold }), "Urlaub");
  item(() => d.page.drawRectangle({ x, y: y - 2, width: 14, height: 9, borderColor: C.warn, borderWidth: 1, borderDashArray: [2, 1.5] }), "Antrag offen");
  item(() => d.page.drawRectangle({ x, y: y - 2, width: 14, height: 9, color: C.bad }), "Überschneidung (2 oder mehr aus derselben Abteilung)");
  d.y -= 18;
}

function overlaps(d: Doc, list: Overlap[]) {
  d.need(20);
  if (!list.length) { d.text("Keine Überschneidungen innerhalb einer Abteilung.", M, d.y - 8, 9); d.y -= 18; return; }
  d.text(`Überschneidungen (${list.length})`, M, d.y - 8, 10, d.b, C.bad); d.y -= 20;
  for (const o of list) {
    d.need(12);
    const when = o.from === o.to ? de(o.from) : `${de(o.from).slice(0, 6)} – ${de(o.to)}`;
    d.text(d.fit(`${when}  ${DEPT_LABEL[o.dept]}: ${o.names.join(", ")}`, W - 2 * M, 8.5), M, d.y - 6, 8.5); d.y -= 12;
  }
  d.y -= 6;
}

function calTable(d: Doc, title: string, days: string[], rows: { r: CalRow; count: Record<string, number>; dept?: DeptKey }[], counts: { label: string; count: Record<string, number>; red: boolean }[]) {
  const nameW = 150, sumW = 34, cw = (W - 2 * M - nameW - sumW) / days.length, rh = 13;
  const header = () => {
    d.text(title, M, d.y - 10, 11, d.b); d.y -= 16;
    days.forEach((day, i) => {
      const x = M + nameW + i * cw;
      if (isWeekend(day)) d.page.drawRectangle({ x, y: d.y - 20, width: cw, height: 20, color: C.wk });
      d.text(WD[new Date(day + "T12:00:00Z").getUTCDay()], x + 2, d.y - 8, 6, d.f, C.mute);
      d.text(String(Number(day.slice(8))), x + 2, d.y - 17, 7.5, d.b);
    });
    d.text("Tage", M + nameW + days.length * cw + 4, d.y - 17, 7.5, d.b);
    d.y -= 22;
  };
  d.need(16 + 22 + rh * 2); header();
  for (const { r, count, dept } of rows) {
    if (d.y - rh < M) { d.newPage(); header(); }
    d.page.drawLine({ start: { x: M, y: d.y }, end: { x: W - M, y: d.y }, thickness: 0.4, color: C.line });
    d.text(d.fit(r.emp.name + (dept ? ` (${DEPT_LABEL[dept]})` : ""), nameW - 4), M + 2, d.y - 9.5);
    days.forEach((day, i) => {
      const x = M + nameW + i * cw;
      if (isWeekend(day)) d.page.drawRectangle({ x, y: d.y - rh, width: cw, height: rh, color: C.wk });
      const m = r.cells[day], clash = m && count[day] >= 2;
      if (m === "U") d.page.drawRectangle({ x: x + 1, y: d.y - rh + 2, width: cw - 2, height: rh - 4, color: clash ? C.bad : C.gold });
      if (m === "A") d.page.drawRectangle({ x: x + 1.5, y: d.y - rh + 2.5, width: cw - 3, height: rh - 5, borderColor: clash ? C.bad : C.warn, borderWidth: 1, borderDashArray: [2, 1.5] });
    });
    d.text(num(r.vacDays) + (r.requestedDays ? ` +${r.requestedDays}` : ""), M + nameW + days.length * cw + 4, d.y - 9.5);
    d.y -= rh;
  }
  for (const c of counts) {
    if (d.y - rh < M) { d.newPage(); header(); }
    d.page.drawLine({ start: { x: M, y: d.y }, end: { x: W - M, y: d.y }, thickness: 0.8, color: C.line });
    d.text(c.label, M + 2, d.y - 9.5, 7.5, d.f, C.mute);
    days.forEach((day, i) => { const v = c.count[day]; if (v) d.text(String(v), M + nameW + i * cw + cw / 2 - 2, d.y - 9.5, 7.5, v >= 2 ? d.b : d.f, v >= 2 ? (c.red ? C.bad : C.warn) : C.ink); });
    d.y -= rh;
  }
  d.y -= 14;
}

async function start(title: string, stand: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`NAYA TIME ${title}`); pdf.setCreator("NAYA TIME");
  // Liberation Sans (SIL OFL) statt Standardschrift: kann alle Namen (ş, ć, Kyrillisch …)
  pdf.registerFontkit(fontkit);
  const font = (f: string) => readFile(path.join(process.cwd(), "assets/fonts", f));
  const d = new Doc(pdf, await pdf.embedFont(await font("LiberationSans-Regular.ttf"), { subset: true }), await pdf.embedFont(await font("LiberationSans-Bold.ttf"), { subset: true }), title, stand);
  d.newPage();
  return d;
}

export async function monthPdf(cal: Calendar, month: string, stand: string): Promise<Uint8Array> {
  const d = await start(`Urlaubsübersicht ${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`, stand);
  legend(d); overlaps(d, cal.overlaps);
  for (const g of cal.groups) calTable(d, DEPT_LABEL[g.dept], cal.days, g.rows.map((r) => ({ r, count: g.count })), [{ label: "Im Urlaub", count: g.count, red: true }]);
  const all = cal.groups.flatMap((g) => g.rows.filter((r) => Object.keys(r.cells).length).map((r) => ({ r, count: g.count, dept: g.dept })));
  if (all.length) {
    d.need(200);
    calTable(d, "Gesamt (alle mit Urlaub)", cal.days, all, [...cal.groups.map((g) => ({ label: `davon ${DEPT_LABEL[g.dept]}`, count: g.count, red: true })), { label: "Gesamt im Urlaub", count: cal.total, red: false }]);
  }
  return d.pdf.save();
}

export async function yearPdf(y: ReturnType<typeof yearTable>, year: number, stand: string): Promise<Uint8Array> {
  const d = await start(`Urlaubsübersicht ${year}`, stand);
  d.text("Urlaubstage je Monat nach Anrechnung (halbe Tage möglich). \"+ Zahl\" = beantragte Kalendertage, noch nicht entschieden.", M, d.y - 8, 8, d.f, C.mute); d.y -= 18;
  const nameW = 170, sumW = 60, cw = (W - 2 * M - nameW - sumW) / 12, rh = 14;
  for (const g of y.groups) {
    const header = () => {
      d.text(DEPT_LABEL[g.dept], M, d.y - 10, 11, d.b); d.y -= 16;
      MONTHS.forEach((m, i) => d.text(m.slice(0, 3), M + nameW + i * cw + cw - 4 - d.b.widthOfTextAtSize(m.slice(0, 3), 8), d.y - 9, 8, d.b));
      d.text("Gesamt", W - M - d.b.widthOfTextAtSize("Gesamt", 8), d.y - 9, 8, d.b); d.y -= 14;
    };
    d.need(30 + rh * 2); header();
    for (const r of g.rows) {
      if (d.y - rh < M) { d.newPage(); header(); }
      d.page.drawLine({ start: { x: M, y: d.y }, end: { x: W - M, y: d.y }, thickness: 0.4, color: C.line });
      d.text(d.fit(r.emp.name, nameW - 4, 8.5), M + 2, d.y - 10, 8.5);
      r.months.forEach((m, i) => {
        const t = num(m.vac) + (m.req ? ` +${m.req}` : "");
        d.text(t, M + nameW + i * cw + cw - 4 - d.f.widthOfTextAtSize(t, 8.5), d.y - 10, 8.5, d.f, m.vac || m.req ? C.ink : C.mute);
      });
      const t = num(r.vacDays) + (r.requestedDays ? ` +${r.requestedDays}` : "");
      d.text(t, W - M - d.b.widthOfTextAtSize(t, 8.5), d.y - 10, 8.5, d.b);
      d.y -= rh;
    }
    d.y -= 14;
  }
  overlaps(d, y.overlaps);
  return d.pdf.save();
}

'use strict';
const ExcelJS = require('exceljs');
const { bildeSchichten, tagesAuswertung, wochenSummen, monatsGrenzen } = require('./zeit');

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Stunden als Excel-Zeitwert (Bruchteil eines Tages) – so kann man in Excel weiterrechnen.
const alsTag = (min) => min / 1440;
const ZEITFORMAT = '[h]:mm';

function uhrzeit(d) {
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function blattName(name, vergeben) {
  let basis = name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28).trim() || 'Mitarbeiter';
  let n = basis;
  let i = 2;
  while (vergeben.has(n.toLowerCase())) n = `${basis} ${i++}`;
  vergeben.add(n.toLowerCase());
  return n;
}

/**
 * @param mitarbeiter  [{id, name}]
 * @param stempelProMa Map(mitarbeiterId -> stempel[])
 */
async function erstelleMonatsExport({ monat, mitarbeiter, stempelProMa, regeln }) {
  const { von } = monatsGrenzen(monat);
  const titel = `${MONATE[von.getMonth()]} ${von.getFullYear()}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NAYA TIME';
  wb.created = new Date();

  const uebersicht = wb.addWorksheet('Übersicht');
  uebersicht.columns = [
    { header: 'Mitarbeiter', key: 'name', width: 28 },
    { header: 'Arbeitstage', key: 'tage', width: 12 },
    { header: 'Brutto', key: 'brutto', width: 12, style: { numFmt: ZEITFORMAT } },
    { header: 'Pausen', key: 'pause', width: 12, style: { numFmt: ZEITFORMAT } },
    { header: 'Netto (Monat)', key: 'netto', width: 14, style: { numFmt: ZEITFORMAT } },
    { header: 'Hinweise', key: 'hinweis', width: 40 },
  ];
  uebersicht.spliceRows(1, 0, [`NAYA TIME – Arbeitszeiten ${titel}`], [`Pausenregel: ${regeln.pauseMinuten} Min. Abzug ab ${regeln.pauseAbStunden} Std. Arbeitszeit pro Tag`], []);
  uebersicht.getRow(1).font = { bold: true, size: 14 };
  uebersicht.getRow(4).font = { bold: true };

  const vergeben = new Set(['übersicht']);

  for (const ma of mitarbeiter) {
    const { schichten, fehler } = bildeSchichten(stempelProMa.get(ma.id) || []);
    const tage = tagesAuswertung(schichten, monat, regeln);
    if (!tage.length) continue;

    const ws = wb.addWorksheet(blattName(ma.name, vergeben));
    ws.columns = [
      { header: 'Datum', key: 'datum', width: 12 },
      { header: 'Tag', key: 'tag', width: 6 },
      { header: 'KW', key: 'kw', width: 6 },
      { header: 'Kommen', key: 'kommen', width: 10 },
      { header: 'Gehen', key: 'gehen', width: 10 },
      { header: 'Brutto', key: 'brutto', width: 10, style: { numFmt: ZEITFORMAT } },
      { header: 'Pause', key: 'pause', width: 10, style: { numFmt: ZEITFORMAT } },
      { header: 'Netto', key: 'netto', width: 10, style: { numFmt: ZEITFORMAT } },
      { header: 'Hinweis', key: 'hinweis', width: 34 },
    ];
    ws.spliceRows(1, 0, [`${ma.name} – ${titel}`], []);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.getRow(3).font = { bold: true };

    const wochen = wochenSummen(tage);
    let aktuelleKw = null;
    const schreibeWoche = (kw) => {
      const w = wochen.find((x) => x.kw === kw);
      const r = ws.addRow({ datum: `Summe KW ${kw}`, brutto: alsTag(w.bruttoMin), pause: alsTag(w.pauseMin), netto: alsTag(w.nettoMin) });
      r.font = { bold: true };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    };

    for (const t of tage) {
      if (aktuelleKw !== null && t.kw !== aktuelleKw) schreibeWoche(aktuelleKw);
      aktuelleKw = t.kw;
      const [j, m, d] = t.datum.split('-');
      const mehrere = t.schichten.length > 1 ? `${t.schichten.length} Schichten` : '';
      ws.addRow({
        datum: `${d}.${m}.${j}`,
        tag: t.wochentag,
        kw: t.kw,
        kommen: uhrzeit(t.kommen),
        gehen: t.gehen ? uhrzeit(t.gehen) + (t.gehen.toDateString() !== t.kommen.toDateString() ? ' (+1)' : '') : '',
        brutto: alsTag(t.bruttoMin),
        pause: alsTag(t.pauseMin),
        netto: alsTag(t.nettoMin),
        hinweis: [t.unvollstaendig ? 'Ausstempeln fehlt – bitte korrigieren' : '', mehrere].filter(Boolean).join('; '),
      });
    }
    if (aktuelleKw !== null) schreibeWoche(aktuelleKw);

    const summe = tage.reduce((a, t) => ({ b: a.b + t.bruttoMin, p: a.p + t.pauseMin, n: a.n + t.nettoMin }), { b: 0, p: 0, n: 0 });
    ws.addRow({});
    const r = ws.addRow({ datum: 'Summe Monat', brutto: alsTag(summe.b), pause: alsTag(summe.p), netto: alsTag(summe.n) });
    r.font = { bold: true, size: 12 };

    const offen = tage.filter((t) => t.unvollstaendig).length;
    const hinweise = [];
    if (offen) hinweise.push(`${offen} Tag(e) ohne Ausstempeln`);
    const { bis } = monatsGrenzen(monat);
    const ohneEin = fehler.filter((f) => {
      const z = new Date(f.stempel.zeit);
      return f.art === 'aus_ohne_ein' && z >= von && z < bis;
    }).length;
    if (ohneEin) hinweise.push(`${ohneEin} Ausstempeln ohne Einstempeln`);
    uebersicht.addRow({ name: ma.name, tage: tage.length, brutto: alsTag(summe.b), pause: alsTag(summe.p), netto: alsTag(summe.n), hinweis: hinweise.join('; ') });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { erstelleMonatsExport };

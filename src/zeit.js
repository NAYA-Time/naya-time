'use strict';
// Reine Berechnungslogik – ohne Datenbank, damit sie gut testbar ist.
// Alle Datumsangaben werden in der Zeitzone des Prozesses (TZ=Europe/Berlin) ausgewertet.

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function tagSchluessel(d) {
  const j = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${j}-${m}-${t}`;
}

// ISO-Kalenderwoche
function kalenderwoche(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const tag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - tag);
  const jahresanfang = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const kw = Math.ceil(((t - jahresanfang) / 86400000 + 1) / 7);
  return { jahr: t.getUTCFullYear(), kw };
}

function monatsGrenzen(monat) {
  const m = /^(\d{4})-(\d{2})$/.exec(monat || '');
  if (!m) throw new Error('Monat im Format JJJJ-MM angeben');
  const jahr = Number(m[1]);
  const mon = Number(m[2]) - 1;
  if (mon < 0 || mon > 11) throw new Error('Ungültiger Monat');
  return { von: new Date(jahr, mon, 1), bis: new Date(jahr, mon + 1, 1) };
}

/**
 * Bildet aus den Stempeln EINES Mitarbeiters (beliebige Reihenfolge) Schichten.
 * Ein "ein" ohne folgendes "aus" ergibt eine offene Schicht (aus = null).
 * Ein "aus" ohne vorheriges "ein" wird als Fehler gemeldet.
 */
function bildeSchichten(stempel) {
  const sortiert = [...stempel].sort((a, b) => new Date(a.zeit) - new Date(b.zeit));
  const schichten = [];
  const fehler = [];
  let offen = null;
  for (const s of sortiert) {
    if (s.typ === 'ein') {
      if (offen) {
        fehler.push({ art: 'ein_ohne_aus', stempel: offen });
        schichten.push({ ein: new Date(offen.zeit), aus: null, einId: offen.id, ausId: null });
      }
      offen = s;
    } else {
      if (!offen) {
        fehler.push({ art: 'aus_ohne_ein', stempel: s });
        continue;
      }
      schichten.push({ ein: new Date(offen.zeit), aus: new Date(s.zeit), einId: offen.id, ausId: s.id });
      offen = null;
    }
  }
  if (offen) schichten.push({ ein: new Date(offen.zeit), aus: null, einId: offen.id, ausId: null, laeuft: true });
  return { schichten, fehler };
}

function minutenZwischen(a, b) {
  return Math.max(0, Math.round((b - a) / 60000));
}

/**
 * Tagesauswertung für einen Monat. Eine Schicht zählt zu dem Tag, an dem sie begonnen hat
 * (wichtig für Schichten über Mitternacht).
 */
function tagesAuswertung(schichten, monat, regeln) {
  const { von, bis } = monatsGrenzen(monat);
  const tage = new Map();
  for (const s of schichten) {
    if (s.ein < von || s.ein >= bis) continue;
    const k = tagSchluessel(s.ein);
    if (!tage.has(k)) tage.set(k, { datum: k, schichten: [], bruttoMin: 0, unvollstaendig: false });
    const t = tage.get(k);
    t.schichten.push(s);
    if (s.aus) t.bruttoMin += minutenZwischen(s.ein, s.aus);
    else t.unvollstaendig = true;
  }
  const ergebnis = [...tage.values()].sort((a, b) => a.datum.localeCompare(b.datum));
  for (const t of ergebnis) {
    const d = t.schichten[0].ein;
    t.wochentag = WOCHENTAGE[d.getDay()];
    t.kw = kalenderwoche(d).kw;
    t.kommen = t.schichten[0].ein;
    const letzte = t.schichten[t.schichten.length - 1];
    t.gehen = letzte.aus;
    const schwelle = regeln.pauseAbStunden * 60;
    t.pauseMin = t.bruttoMin > 0 && t.bruttoMin > schwelle ? Math.min(regeln.pauseMinuten, t.bruttoMin) : 0;
    t.nettoMin = t.bruttoMin - t.pauseMin;
  }
  return ergebnis;
}

function wochenSummen(tage) {
  const wochen = new Map();
  for (const t of tage) {
    if (!wochen.has(t.kw)) wochen.set(t.kw, { kw: t.kw, nettoMin: 0, bruttoMin: 0, pauseMin: 0 });
    const w = wochen.get(t.kw);
    w.nettoMin += t.nettoMin;
    w.bruttoMin += t.bruttoMin;
    w.pauseMin += t.pauseMin;
  }
  return [...wochen.values()];
}

function alsStunden(min) {
  const vz = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${vz}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

module.exports = {
  bildeSchichten,
  tagesAuswertung,
  wochenSummen,
  monatsGrenzen,
  kalenderwoche,
  tagSchluessel,
  alsStunden,
  minutenZwischen,
};

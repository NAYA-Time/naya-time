'use strict';
process.env.TZ = 'Europe/Berlin';
const test = require('node:test');
const assert = require('node:assert');
const { bildeSchichten, tagesAuswertung, wochenSummen, kalenderwoche } = require('../src/zeit');

const regeln = { pauseMinuten: 30, pauseAbStunden: 6 };
const s = (id, typ, lokal) => ({ id, typ, zeit: new Date(lokal).toISOString() });

test('Schicht über 6 Std. bekommt 30 Min. Pause', () => {
  const { schichten } = bildeSchichten([s(1, 'ein', '2026-11-02T10:00'), s(2, 'aus', '2026-11-02T18:15')]);
  const [t] = tagesAuswertung(schichten, '2026-11', regeln);
  assert.equal(t.bruttoMin, 495);
  assert.equal(t.pauseMin, 30);
  assert.equal(t.nettoMin, 465);
  assert.equal(t.wochentag, 'Mo');
});

test('Schicht bis 6 Std. ohne Pause', () => {
  const { schichten } = bildeSchichten([s(1, 'ein', '2026-11-02T17:00'), s(2, 'aus', '2026-11-02T23:00')]);
  const [t] = tagesAuswertung(schichten, '2026-11', regeln);
  assert.equal(t.pauseMin, 0);
  assert.equal(t.nettoMin, 360);
});

test('PAUSE_AB_STUNDEN=0 zieht immer ab', () => {
  const { schichten } = bildeSchichten([s(1, 'ein', '2026-11-02T17:00'), s(2, 'aus', '2026-11-02T19:00')]);
  const [t] = tagesAuswertung(schichten, '2026-11', { pauseMinuten: 30, pauseAbStunden: 0 });
  assert.equal(t.nettoMin, 90);
});

test('Schicht über Mitternacht zählt zum Starttag', () => {
  const { schichten } = bildeSchichten([s(1, 'ein', '2026-11-06T17:00'), s(2, 'aus', '2026-11-07T01:30')]);
  const tage = tagesAuswertung(schichten, '2026-11', regeln);
  assert.equal(tage.length, 1);
  assert.equal(tage[0].datum, '2026-11-06');
  assert.equal(tage[0].bruttoMin, 510);
});

test('Geteilte Schicht: Pause nach Tagessumme', () => {
  const { schichten } = bildeSchichten([
    s(1, 'ein', '2026-11-03T11:00'), s(2, 'aus', '2026-11-03T14:30'),
    s(3, 'ein', '2026-11-03T17:30'), s(4, 'aus', '2026-11-03T22:30'),
  ]);
  const [t] = tagesAuswertung(schichten, '2026-11', regeln);
  assert.equal(t.bruttoMin, 510);
  assert.equal(t.nettoMin, 480);
  assert.equal(t.schichten.length, 2);
});

test('Vergessenes Ausstempeln wird markiert, nicht gezählt', () => {
  const { schichten, fehler } = bildeSchichten([
    s(1, 'ein', '2026-11-03T10:00'),
    s(2, 'ein', '2026-11-04T10:00'), s(3, 'aus', '2026-11-04T16:00'),
  ]);
  const tage = tagesAuswertung(schichten, '2026-11', regeln);
  assert.equal(fehler[0].art, 'ein_ohne_aus');
  assert.equal(tage[0].unvollstaendig, true);
  assert.equal(tage[0].nettoMin, 0);
  assert.equal(tage[1].nettoMin, 360);
});

test('Ausstempeln ohne Einstempeln wird gemeldet', () => {
  const { schichten, fehler } = bildeSchichten([s(1, 'aus', '2026-11-03T10:00')]);
  assert.equal(schichten.length, 0);
  assert.equal(fehler[0].art, 'aus_ohne_ein');
});

test('Sommer-/Winterzeit: Umstellung 25.10.2026', () => {
  // In der Nacht der Umstellung hat die Nacht eine Stunde mehr
  const { schichten } = bildeSchichten([s(1, 'ein', '2026-10-24T20:00'), s(2, 'aus', '2026-10-25T04:00')]);
  const [t] = tagesAuswertung(schichten, '2026-10', regeln);
  assert.equal(t.bruttoMin, 9 * 60);
});

test('Wochensummen und KW', () => {
  assert.equal(kalenderwoche(new Date('2026-11-09T12:00')).kw, 46);
  assert.equal(kalenderwoche(new Date('2027-01-01T12:00')).kw, 53);
  const { schichten } = bildeSchichten([
    s(1, 'ein', '2026-11-08T10:00'), s(2, 'aus', '2026-11-08T14:00'), // So, KW 45
    s(3, 'ein', '2026-11-09T10:00'), s(4, 'aus', '2026-11-09T14:00'), // Mo, KW 46
  ]);
  const w = wochenSummen(tagesAuswertung(schichten, '2026-11', regeln));
  assert.deepEqual(w.map((x) => [x.kw, x.nettoMin]), [[45, 240], [46, 240]]);
});

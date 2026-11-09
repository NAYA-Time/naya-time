'use strict';
process.env.TZ = 'Europe/Berlin';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { erstelleApp } = require('../src/app');

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'naya-time-'));
const config = {
  datenOrdner: ordner,
  adminPasswort: 'test-passwort',
  sessionSecret: 'x'.repeat(40),
  terminalSchluessel: 'terminal-schluessel-123',
  pauseMinuten: 30,
  pauseAbStunden: 6,
  fotoAufbewahrungTage: 90,
  produktion: false,
};
// kleinstes gültiges JPEG-ähnliches Bild (Header + Füllung)
const FOTO = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]).toString('base64');

let server, basis, adminCookie, terminalCookie;

async function anfrage(pfad, { methode = 'GET', body, cookie } = {}) {
  const r = await fetch(basis + pfad, {
    method: methode,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}
const cookieAus = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

test.before(async () => {
  const { app } = erstelleApp(config);
  await new Promise((ok) => (server = app.listen(0, ok)));
  basis = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(ordner, { recursive: true, force: true }); });

test('Admin-Login', async () => {
  assert.equal((await anfrage('/api/admin/mitarbeiter')).status, 401);
  assert.equal((await anfrage('/api/admin/login', { methode: 'POST', body: { passwort: 'falsch' } })).status, 401);
  const r = await anfrage('/api/admin/login', { methode: 'POST', body: { passwort: 'test-passwort' } });
  assert.equal(r.status, 200);
  adminCookie = cookieAus(r);
  assert.equal((await anfrage('/api/admin/mitarbeiter', { cookie: adminCookie })).status, 200);
});

test('Terminal nur mit Schlüssel', async () => {
  assert.equal((await anfrage('/terminal')).status, 403);
  assert.equal((await anfrage('/terminal?schluessel=falsch')).status, 403);
  const r = await anfrage('/terminal?schluessel=terminal-schluessel-123');
  assert.equal(r.status, 302);
  terminalCookie = cookieAus(r);
  assert.equal((await anfrage('/terminal', { cookie: terminalCookie })).status, 200);
  assert.equal((await anfrage('/api/terminal/mitarbeiter')).status, 403);
});

test('Ein- und Ausstempeln mit PIN und Foto', async () => {
  const neu = await (await anfrage('/api/admin/mitarbeiter', { methode: 'POST', cookie: adminCookie, body: { name: 'Anna Test', pin: '1234' } })).json();
  assert.equal((await anfrage('/api/admin/mitarbeiter', { methode: 'POST', cookie: adminCookie, body: { name: 'X', pin: '12' } })).status, 400);

  const liste = await (await anfrage('/api/terminal/mitarbeiter', { cookie: terminalCookie })).json();
  assert.deepEqual(liste.map((m) => [m.name, m.anwesend]), [['Anna Test', false]]);

  assert.equal((await anfrage('/api/terminal/stempeln', { methode: 'POST', cookie: terminalCookie, body: { mitarbeiterId: neu.id, pin: '9999', foto: FOTO } })).status, 401);
  assert.equal((await anfrage('/api/terminal/stempeln', { methode: 'POST', cookie: terminalCookie, body: { mitarbeiterId: neu.id, pin: '1234' } })).status, 400);

  const ein = await (await anfrage('/api/terminal/stempeln', { methode: 'POST', cookie: terminalCookie, body: { mitarbeiterId: neu.id, pin: '1234', foto: FOTO } })).json();
  assert.equal(ein.typ, 'ein');
  const aus = await (await anfrage('/api/terminal/stempeln', { methode: 'POST', cookie: terminalCookie, body: { mitarbeiterId: neu.id, pin: '1234', foto: FOTO } })).json();
  assert.equal(aus.typ, 'aus');

  const monat = ein.zeit.slice(0, 7);
  const stempel = await (await anfrage(`/api/admin/stempel?monat=${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, { cookie: adminCookie })).json();
  assert.equal(stempel.length, 2);
  assert.ok(stempel[0].hatFoto);
  const foto = await anfrage(`/api/admin/foto/${stempel[0].id}`, { cookie: adminCookie });
  assert.equal(foto.status, 200);
  assert.equal((await anfrage(`/api/admin/foto/${stempel[0].id}`)).status, 401);
  assert.ok(monat);
});

test('PIN-Sperre nach 5 Fehlversuchen', async () => {
  const neu = await (await anfrage('/api/admin/mitarbeiter', { methode: 'POST', cookie: adminCookie, body: { name: 'Ben Sperre', pin: '4321' } })).json();
  for (let i = 0; i < 5; i++) await anfrage('/api/terminal/stempeln', { methode: 'POST', cookie: terminalCookie, body: { mitarbeiterId: neu.id, pin: '0000', foto: FOTO } });
  const r = await anfrage('/api/terminal/stempeln', { methode: 'POST', cookie: terminalCookie, body: { mitarbeiterId: neu.id, pin: '4321', foto: FOTO } });
  assert.equal(r.status, 429);
});

test('Nachtragen, Korrigieren, Protokoll und Excel-Export', async () => {
  const neu = await (await anfrage('/api/admin/mitarbeiter', { methode: 'POST', cookie: adminCookie, body: { name: 'Carla Küche', pin: '5555' } })).json();
  const nt = async (typ, lokal) => (await anfrage('/api/admin/stempel', { methode: 'POST', cookie: adminCookie, body: { mitarbeiterId: neu.id, typ, zeit: new Date(lokal).toISOString(), notiz: 'Test' } })).json();
  await nt('ein', '2026-10-05T10:00');
  const aus = await nt('aus', '2026-10-05T17:00');
  await nt('ein', '2026-10-06T16:00'); // Ausstempeln vergessen

  assert.equal((await anfrage(`/api/admin/stempel/${aus.id}`, { methode: 'PATCH', cookie: adminCookie, body: { zeit: new Date('2026-10-05T18:30').toISOString(), notiz: 'korrigiert' } })).status, 200);

  const aw = await (await anfrage('/api/admin/auswertung?monat=2026-10', { cookie: adminCookie })).json();
  const carla = aw.find((m) => m.name === 'Carla Küche');
  assert.equal(carla.tage[0].nettoMin, 8 * 60);
  assert.equal(carla.tage[1].unvollstaendig, true);

  const p = await (await anfrage('/api/admin/protokoll', { cookie: adminCookie })).json();
  assert.ok(p.some((x) => x.aktion === 'stempel_korrigiert'));

  const r = await anfrage('/api/admin/export?monat=2026-10', { cookie: adminCookie });
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Übersicht', 'Carla Küche']);
  const ue = wb.getWorksheet('Übersicht');
  const zeile = ue.getRow(5);
  assert.equal(zeile.getCell(1).value, 'Carla Küche');
  const v = zeile.getCell(5).value; // ExcelJS liest Zeitformate als Datum zurück
  const min = v instanceof Date ? Math.round((v - Date.UTC(1899, 11, 30)) / 60000) : Math.round(v * 1440);
  assert.equal(min, 480);
  assert.match(String(zeile.getCell(6).value), /ohne Ausstempeln/);
});

test('Vergessenes Ausstempeln: nächster Stempel ist wieder Kommen', async () => {
  const neu = await (await anfrage('/api/admin/mitarbeiter', { methode: 'POST', cookie: adminCookie, body: { name: 'Dana Vergesslich', pin: '7777' } })).json();
  await anfrage('/api/admin/stempel', { methode: 'POST', cookie: adminCookie, body: { mitarbeiterId: neu.id, typ: 'ein', zeit: new Date(Date.now() - 30 * 36e5).toISOString() } });
  const liste = await (await anfrage('/api/terminal/mitarbeiter', { cookie: terminalCookie })).json();
  assert.equal(liste.find((m) => m.id === neu.id).anwesend, false);
  const r = await (await anfrage('/api/terminal/stempeln', { methode: 'POST', cookie: terminalCookie, body: { mitarbeiterId: neu.id, pin: '7777', foto: FOTO } })).json();
  assert.equal(r.typ, 'ein');
  assert.ok(r.vergessenSeit);
});

test('Fotos werden nach Frist gelöscht', async () => {
  const { app, db, aufraeumen } = erstelleApp({ ...config, fotoAufbewahrungTage: 1 });
  void app;
  const datei = path.join('fotos', 'alt.jpg');
  fs.writeFileSync(path.join(ordner, datei), 'x');
  const ma = db.prepare('SELECT id FROM mitarbeiter LIMIT 1').get();
  db.prepare("INSERT INTO stempel (mitarbeiter_id, typ, zeit, foto) VALUES (?, 'ein', ?, ?)").run(ma.id, new Date(Date.now() - 3 * 864e5).toISOString(), datei);
  assert.ok(aufraeumen() >= 1);
  assert.equal(fs.existsSync(path.join(ordner, datei)), false);
});

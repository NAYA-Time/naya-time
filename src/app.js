'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { oeffneDb } = require('./db');
const auth = require('./auth');
const { bildeSchichten, tagesAuswertung, wochenSummen, monatsGrenzen } = require('./zeit');
const { erstelleMonatsExport } = require('./export');

const MAX_FEHLVERSUCHE = 5;
const SPERRE_MINUTEN = 5;
const ADMIN_SITZUNG_STUNDEN = 12;
const TERMINAL_COOKIE_TAGE = 365;

function erstelleApp(config) {
  const db = oeffneDb(config.datenOrdner);
  const fotoOrdner = path.join(config.datenOrdner, 'fotos');
  fs.mkdirSync(fotoOrdner, { recursive: true });
  const regeln = { pauseMinuten: config.pauseMinuten, pauseAbStunden: config.pauseAbStunden };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '3mb' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  const cookieOptionen = (maxAlterSek) =>
    `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAlterSek}${config.produktion ? '; Secure' : ''}`;

  const protokolliere = (aktion, details) =>
    db.prepare('INSERT INTO protokoll (aktion, details) VALUES (?, ?)').run(aktion, JSON.stringify(details));

  // ---------- Terminal (iPad) ----------
  // Das iPad wird einmalig mit /terminal?schluessel=... freigeschaltet und bekommt ein Cookie.
  function terminalFreigegeben(req) {
    const c = auth.leseCookies(req);
    const wert = auth.lese(c.naya_terminal, config.sessionSecret);
    return wert && wert.rolle === 'terminal';
  }

  app.get('/terminal', (req, res, next) => {
    if (req.query.schluessel !== undefined) {
      if (!auth.gleich(req.query.schluessel, config.terminalSchluessel)) {
        return res.status(403).send('Falscher Terminal-Schlüssel.');
      }
      const token = auth.signiere({ rolle: 'terminal', ablauf: Date.now() + TERMINAL_COOKIE_TAGE * 864e5 }, config.sessionSecret);
      res.set('Set-Cookie', `naya_terminal=${encodeURIComponent(token)}; ${cookieOptionen(TERMINAL_COOKIE_TAGE * 86400)}`);
      return res.redirect('/terminal');
    }
    if (!terminalFreigegeben(req)) {
      return res.status(403).sendFile(path.join(__dirname, '..', 'public', 'nicht-freigegeben.html'));
    }
    next();
  });
  app.get('/terminal', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'terminal.html')));

  const nurTerminal = (req, res, next) =>
    terminalFreigegeben(req) ? next() : res.status(403).json({ fehler: 'Terminal nicht freigegeben' });

  function letzterStempel(maId) {
    return db
      .prepare('SELECT typ, zeit FROM stempel WHERE mitarbeiter_id = ? AND geloescht = 0 ORDER BY zeit DESC LIMIT 1')
      .get(maId);
  }

  // Aktuell offene Schicht – nur wenn das Einstempeln nicht zu lange her ist (sonst: Ausstempeln vergessen).
  function offeneSchicht(maId) {
    const l = letzterStempel(maId);
    if (!l || l.typ !== 'ein') return { offen: null, vergessen: null };
    const alterStd = (Date.now() - new Date(l.zeit)) / 36e5;
    return alterStd <= (config.maxSchichtStunden || 16) ? { offen: l, vergessen: null } : { offen: null, vergessen: l };
  }

  app.get('/api/terminal/mitarbeiter', nurTerminal, (req, res) => {
    const liste = db.prepare('SELECT id, name FROM mitarbeiter WHERE aktiv = 1 ORDER BY name COLLATE NOCASE').all();
    res.json(
      liste.map((m) => {
        const { offen } = offeneSchicht(m.id);
        return { id: m.id, name: m.name, anwesend: !!offen, seit: offen ? offen.zeit : null };
      })
    );
  });

  app.post('/api/terminal/stempeln', nurTerminal, (req, res) => {
    const { mitarbeiterId, pin, foto } = req.body || {};
    const ma = db.prepare('SELECT * FROM mitarbeiter WHERE id = ? AND aktiv = 1').get(Number(mitarbeiterId));
    if (!ma) return res.status(404).json({ fehler: 'Mitarbeiter nicht gefunden' });

    if (ma.gesperrt_bis && new Date(ma.gesperrt_bis) > new Date()) {
      return res.status(429).json({ fehler: `Zu viele falsche Versuche. Bitte in ${SPERRE_MINUTEN} Minuten erneut versuchen.` });
    }
    if (!auth.pruefePin(pin, ma.pin_hash)) {
      const versuche = ma.fehlversuche + 1;
      const sperre = versuche >= MAX_FEHLVERSUCHE ? new Date(Date.now() + SPERRE_MINUTEN * 60000).toISOString() : null;
      db.prepare('UPDATE mitarbeiter SET fehlversuche = ?, gesperrt_bis = ? WHERE id = ?').run(sperre ? 0 : versuche, sperre, ma.id);
      return res.status(401).json({ fehler: sperre ? 'Zu viele falsche Versuche – 5 Minuten gesperrt.' : 'PIN falsch' });
    }
    db.prepare('UPDATE mitarbeiter SET fehlversuche = 0, gesperrt_bis = NULL WHERE id = ?').run(ma.id);

    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(foto || '');
    if (!m) return res.status(400).json({ fehler: 'Foto fehlt – bitte Kamera erlauben.' });
    const bild = Buffer.from(m[1], 'base64');
    if (bild.length < 1000 || bild[0] !== 0xff || bild[1] !== 0xd8) return res.status(400).json({ fehler: 'Foto ungültig' });

    const { offen, vergessen } = offeneSchicht(ma.id);
    const typ = offen ? 'aus' : 'ein';
    const jetzt = new Date();
    const unterordner = jetzt.toISOString().slice(0, 7);
    fs.mkdirSync(path.join(fotoOrdner, unterordner), { recursive: true });

    const r = db.prepare("INSERT INTO stempel (mitarbeiter_id, typ, zeit, quelle) VALUES (?, ?, ?, 'terminal')").run(ma.id, typ, jetzt.toISOString());
    const relPfad = path.join('fotos', unterordner, `${r.lastInsertRowid}.jpg`);
    fs.writeFileSync(path.join(config.datenOrdner, relPfad), bild);
    db.prepare('UPDATE stempel SET foto = ? WHERE id = ?').run(relPfad, r.lastInsertRowid);

    let dauerMin = null;
    if (typ === 'aus') dauerMin = Math.round((jetzt - new Date(offen.zeit)) / 60000);
    res.json({ typ, zeit: jetzt.toISOString(), name: ma.name, dauerMin, vergessenSeit: vergessen ? vergessen.zeit : null });
  });

  // ---------- Admin ----------
  function istAdmin(req) {
    const c = auth.leseCookies(req);
    const wert = auth.lese(c.naya_admin, config.sessionSecret);
    return wert && wert.rolle === 'admin';
  }
  const nurAdmin = (req, res, next) => (istAdmin(req) ? next() : res.status(401).json({ fehler: 'Bitte anmelden' }));

  let adminFehlversuche = 0;
  let adminGesperrtBis = 0;
  app.post('/api/admin/login', (req, res) => {
    if (Date.now() < adminGesperrtBis) return res.status(429).json({ fehler: 'Zu viele Versuche, bitte kurz warten.' });
    if (!auth.gleich((req.body || {}).passwort || '', config.adminPasswort)) {
      adminFehlversuche++;
      if (adminFehlversuche >= MAX_FEHLVERSUCHE) {
        adminGesperrtBis = Date.now() + SPERRE_MINUTEN * 60000;
        adminFehlversuche = 0;
      }
      return res.status(401).json({ fehler: 'Passwort falsch' });
    }
    adminFehlversuche = 0;
    const token = auth.signiere({ rolle: 'admin', ablauf: Date.now() + ADMIN_SITZUNG_STUNDEN * 36e5 }, config.sessionSecret);
    res.set('Set-Cookie', `naya_admin=${encodeURIComponent(token)}; ${cookieOptionen(ADMIN_SITZUNG_STUNDEN * 3600)}`);
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.set('Set-Cookie', `naya_admin=; ${cookieOptionen(0)}`);
    res.json({ ok: true });
  });

  app.get('/api/admin/status', (req, res) => res.json({ angemeldet: !!istAdmin(req) }));

  app.get('/api/admin/einstellungen', nurAdmin, (req, res) =>
    res.json({
      ...regeln,
      fotoAufbewahrungTage: config.fotoAufbewahrungTage,
      terminalLink: `${req.protocol}://${req.get('host')}/terminal?schluessel=${encodeURIComponent(config.terminalSchluessel)}`,
    })
  );

  // Mitarbeiter
  app.get('/api/admin/mitarbeiter', nurAdmin, (req, res) => {
    const liste = db.prepare('SELECT id, name, aktiv, erstellt FROM mitarbeiter ORDER BY aktiv DESC, name COLLATE NOCASE').all();
    res.json(liste.map((m) => ({ ...m, aktiv: !!m.aktiv, anwesend: !!offeneSchicht(m.id).offen, ausstempelnVergessen: !!offeneSchicht(m.id).vergessen })));
  });

  app.post('/api/admin/mitarbeiter', nurAdmin, (req, res) => {
    const name = String((req.body || {}).name || '').trim();
    const pin = String((req.body || {}).pin || '');
    if (!name) return res.status(400).json({ fehler: 'Name fehlt' });
    if (!auth.gueltigePin(pin)) return res.status(400).json({ fehler: 'PIN muss 4–6 Ziffern haben' });
    const r = db.prepare('INSERT INTO mitarbeiter (name, pin_hash) VALUES (?, ?)').run(name, auth.hashPin(pin));
    protokolliere('mitarbeiter_angelegt', { id: Number(r.lastInsertRowid), name });
    res.json({ id: Number(r.lastInsertRowid) });
  });

  app.patch('/api/admin/mitarbeiter/:id', nurAdmin, (req, res) => {
    const id = Number(req.params.id);
    const ma = db.prepare('SELECT * FROM mitarbeiter WHERE id = ?').get(id);
    if (!ma) return res.status(404).json({ fehler: 'Nicht gefunden' });
    const { name, pin, aktiv } = req.body || {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ fehler: 'Name fehlt' });
      db.prepare('UPDATE mitarbeiter SET name = ? WHERE id = ?').run(String(name).trim(), id);
    }
    if (pin !== undefined) {
      if (!auth.gueltigePin(pin)) return res.status(400).json({ fehler: 'PIN muss 4–6 Ziffern haben' });
      db.prepare('UPDATE mitarbeiter SET pin_hash = ?, fehlversuche = 0, gesperrt_bis = NULL WHERE id = ?').run(auth.hashPin(pin), id);
    }
    if (aktiv !== undefined) db.prepare('UPDATE mitarbeiter SET aktiv = ? WHERE id = ?').run(aktiv ? 1 : 0, id);
    protokolliere('mitarbeiter_geaendert', { id, name, pinGeaendert: pin !== undefined, aktiv });
    res.json({ ok: true });
  });

  // Stempel eines Monats laden (inkl. 1 Tag davor/danach für Schichten über Mitternacht)
  function stempelImMonat(monat, maId) {
    const { von, bis } = monatsGrenzen(monat);
    const a = new Date(von.getTime() - 864e5).toISOString();
    const b = new Date(bis.getTime() + 864e5).toISOString();
    const sql =
      'SELECT id, mitarbeiter_id, typ, zeit, foto IS NOT NULL AS hatFoto, quelle, notiz FROM stempel WHERE geloescht = 0 AND zeit >= ? AND zeit < ?' +
      (maId ? ' AND mitarbeiter_id = ?' : '') +
      ' ORDER BY zeit';
    return maId ? db.prepare(sql).all(a, b, maId) : db.prepare(sql).all(a, b);
  }

  function gruppiere(stempel) {
    const m = new Map();
    for (const s of stempel) {
      if (!m.has(s.mitarbeiter_id)) m.set(s.mitarbeiter_id, []);
      m.get(s.mitarbeiter_id).push(s);
    }
    return m;
  }

  app.get('/api/admin/stempel', nurAdmin, (req, res) => {
    try {
      const { von, bis } = monatsGrenzen(req.query.monat);
      const liste = stempelImMonat(req.query.monat, req.query.mitarbeiter ? Number(req.query.mitarbeiter) : null).filter((s) => {
        const z = new Date(s.zeit);
        return z >= von && z < bis;
      });
      res.json(liste.map((s) => ({ ...s, hatFoto: !!s.hatFoto })));
    } catch (e) {
      res.status(400).json({ fehler: e.message });
    }
  });

  function pruefeStempelEingabe(body) {
    const { typ, zeit } = body || {};
    if (typ !== 'ein' && typ !== 'aus') return 'Typ muss "ein" oder "aus" sein';
    if (!zeit || Number.isNaN(new Date(zeit).getTime())) return 'Zeit ungültig';
    if (new Date(zeit) > new Date(Date.now() + 5 * 60000)) return 'Zeit liegt in der Zukunft';
    return null;
  }

  app.post('/api/admin/stempel', nurAdmin, (req, res) => {
    const fehler = pruefeStempelEingabe(req.body);
    if (fehler) return res.status(400).json({ fehler });
    const { mitarbeiterId, typ, zeit, notiz } = req.body;
    if (!db.prepare('SELECT 1 FROM mitarbeiter WHERE id = ?').get(Number(mitarbeiterId))) return res.status(404).json({ fehler: 'Mitarbeiter nicht gefunden' });
    const iso = new Date(zeit).toISOString();
    const r = db
      .prepare("INSERT INTO stempel (mitarbeiter_id, typ, zeit, quelle, notiz) VALUES (?, ?, ?, 'admin', ?)")
      .run(Number(mitarbeiterId), typ, iso, notiz ? String(notiz) : null);
    protokolliere('stempel_nachgetragen', { id: Number(r.lastInsertRowid), mitarbeiterId: Number(mitarbeiterId), typ, zeit: iso, notiz });
    res.json({ id: Number(r.lastInsertRowid) });
  });

  app.patch('/api/admin/stempel/:id', nurAdmin, (req, res) => {
    const id = Number(req.params.id);
    const alt = db.prepare('SELECT * FROM stempel WHERE id = ? AND geloescht = 0').get(id);
    if (!alt) return res.status(404).json({ fehler: 'Nicht gefunden' });
    const neu = { typ: req.body.typ ?? alt.typ, zeit: req.body.zeit ?? alt.zeit };
    const fehler = pruefeStempelEingabe(neu);
    if (fehler) return res.status(400).json({ fehler });
    const iso = new Date(neu.zeit).toISOString();
    const notiz = req.body.notiz !== undefined ? String(req.body.notiz) : alt.notiz;
    db.prepare('UPDATE stempel SET typ = ?, zeit = ?, notiz = ? WHERE id = ?').run(neu.typ, iso, notiz, id);
    protokolliere('stempel_korrigiert', { id, vorher: { typ: alt.typ, zeit: alt.zeit, notiz: alt.notiz }, nachher: { typ: neu.typ, zeit: iso, notiz } });
    res.json({ ok: true });
  });

  app.delete('/api/admin/stempel/:id', nurAdmin, (req, res) => {
    const id = Number(req.params.id);
    const alt = db.prepare('SELECT * FROM stempel WHERE id = ? AND geloescht = 0').get(id);
    if (!alt) return res.status(404).json({ fehler: 'Nicht gefunden' });
    db.prepare('UPDATE stempel SET geloescht = 1 WHERE id = ?').run(id);
    protokolliere('stempel_geloescht', { id, typ: alt.typ, zeit: alt.zeit, mitarbeiterId: alt.mitarbeiter_id });
    res.json({ ok: true });
  });

  app.get('/api/admin/foto/:id', nurAdmin, (req, res) => {
    const s = db.prepare('SELECT foto FROM stempel WHERE id = ?').get(Number(req.params.id));
    if (!s || !s.foto) return res.status(404).end();
    const voll = path.resolve(config.datenOrdner, s.foto);
    if (!voll.startsWith(fotoOrdner + path.sep) || !fs.existsSync(voll)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600');
    res.type('jpeg').sendFile(voll);
  });

  app.get('/api/admin/auswertung', nurAdmin, (req, res) => {
    try {
      const monat = req.query.monat;
      const gruppen = gruppiere(stempelImMonat(monat));
      const mitarbeiter = db.prepare('SELECT id, name, aktiv FROM mitarbeiter ORDER BY name COLLATE NOCASE').all();
      const ergebnis = [];
      for (const ma of mitarbeiter) {
        const { schichten } = bildeSchichten(gruppen.get(ma.id) || []);
        const tage = tagesAuswertung(schichten, monat, regeln);
        if (!tage.length && !ma.aktiv) continue;
        ergebnis.push({
          id: ma.id,
          name: ma.name,
          tage: tage.map((t) => ({ datum: t.datum, wochentag: t.wochentag, kw: t.kw, kommen: t.kommen, gehen: t.gehen, bruttoMin: t.bruttoMin, pauseMin: t.pauseMin, nettoMin: t.nettoMin, unvollstaendig: t.unvollstaendig })),
          wochen: wochenSummen(tage),
          nettoMin: tage.reduce((a, t) => a + t.nettoMin, 0),
        });
      }
      res.json(ergebnis);
    } catch (e) {
      res.status(400).json({ fehler: e.message });
    }
  });

  app.get('/api/admin/export', nurAdmin, async (req, res) => {
    try {
      const monat = req.query.monat;
      const gruppen = gruppiere(stempelImMonat(monat));
      const mitarbeiter = db.prepare('SELECT id, name FROM mitarbeiter ORDER BY name COLLATE NOCASE').all();
      const puffer = await erstelleMonatsExport({ monat, mitarbeiter, stempelProMa: gruppen, regeln });
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="NAYA-TIME-${monat}.xlsx"`);
      res.send(Buffer.from(puffer));
    } catch (e) {
      res.status(400).json({ fehler: e.message });
    }
  });

  app.get('/api/admin/protokoll', nurAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM protokoll ORDER BY id DESC LIMIT 200').all().map((p) => ({ ...p, details: JSON.parse(p.details) })));
  });

  // ---------- Statische Seiten ----------
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
  app.get('/gesund', (req, res) => res.json({ ok: true }));

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ fehler: err.type === 'entity.too.large' ? 'Foto zu groß' : 'Interner Fehler' });
  });

  // Fotos nach Aufbewahrungsfrist löschen
  function aufraeumen() {
    if (!config.fotoAufbewahrungTage) return 0;
    const grenze = new Date(Date.now() - config.fotoAufbewahrungTage * 864e5).toISOString();
    const alte = db.prepare('SELECT id, foto FROM stempel WHERE foto IS NOT NULL AND zeit < ?').all(grenze);
    for (const s of alte) {
      try {
        fs.rmSync(path.join(config.datenOrdner, s.foto), { force: true });
      } catch (e) {
        console.error('Foto konnte nicht gelöscht werden', s.foto, e.message);
        continue;
      }
      db.prepare('UPDATE stempel SET foto = NULL WHERE id = ?').run(s.id);
    }
    if (alte.length) console.log(`${alte.length} alte Fotos gelöscht`);
    return alte.length;
  }

  return { app, db, aufraeumen };
}

module.exports = { erstelleApp };

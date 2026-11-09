'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const zwei = (n) => String(n).padStart(2, '0');
  const stunden = (min) => `${Math.floor(min / 60)}:${zwei(min % 60)}`;
  const uhrzeit = (iso) => { const d = new Date(iso); return `${zwei(d.getHours())}:${zwei(d.getMinutes())}`; };
  const datum = (iso) => { const d = new Date(iso); return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const datumAusSchluessel = (k) => { const [j, m, t] = k.split('-'); return `${t}.${m}.${j}`; };
  const lokalesInput = (d) => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
  const diesenMonat = () => { const d = new Date(); return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}`; };
  const el = (tag, attrs = {}, ...kinder) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const k of kinder) if (k) e.append(k);
    return e;
  };

  let mitarbeiter = [];

  function meldung(text, fehler) {
    const m = $('meldung');
    m.textContent = text;
    m.className = 'meldung zeigen' + (fehler ? ' fehler' : '');
    clearTimeout(meldung.t);
    meldung.t = setTimeout(() => (m.className = 'meldung'), 3500);
  }

  async function api(pfad, optionen = {}) {
    const r = await fetch(pfad, {
      ...optionen,
      headers: { 'Content-Type': 'application/json', ...(optionen.headers || {}) },
      body: optionen.body ? JSON.stringify(optionen.body) : undefined,
    });
    if (r.status === 401 && pfad !== '/api/admin/login') { zeigeLogin(); throw new Error('Bitte anmelden'); }
    const daten = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(daten.fehler || 'Fehler');
    return daten;
  }

  // ---- Login ----
  function zeigeLogin() { $('login').hidden = false; $('app').hidden = true; $('passwort').focus(); }
  async function zeigeApp() { $('login').hidden = true; $('app').hidden = false; await ladeMitarbeiter(); zeigeReiter('stempel'); }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', body: { passwort: $('passwort').value } });
      $('passwort').value = '';
      $('login-fehler').textContent = '';
      zeigeApp();
    } catch (err) { $('login-fehler').textContent = err.message; }
  });
  $('abmelden').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); zeigeLogin(); });

  // ---- Reiter ----
  function zeigeReiter(name) {
    document.querySelectorAll('#reiter button[data-r]').forEach((b) => b.classList.toggle('aktiv', b.dataset.r === name));
    document.querySelectorAll('section[data-seite]').forEach((s) => (s.hidden = s.dataset.seite !== name));
    ({ stempel: ladeStempel, auswertung: ladeAuswertung, mitarbeiter: zeigeMitarbeiter, einstellungen: ladeEinstellungen })[name]();
  }
  document.querySelectorAll('#reiter button[data-r]').forEach((b) => b.addEventListener('click', () => zeigeReiter(b.dataset.r)));

  // ---- Mitarbeiter ----
  async function ladeMitarbeiter() {
    mitarbeiter = await api('/api/admin/mitarbeiter');
    const optionen = (leer) => [leer ? el('option', { value: '', text: 'Alle Mitarbeiter' }) : null, ...mitarbeiter.filter((m) => m.aktiv || leer).map((m) => el('option', { value: m.id, text: m.name }))].filter(Boolean);
    const filter = $('st-ma').value;
    $('st-ma').replaceChildren(...optionen(true));
    $('st-ma').value = filter;
    $('nt-ma').replaceChildren(...optionen(false));
  }

  function zeigeMitarbeiter() {
    const tb = $('ma-liste');
    tb.replaceChildren();
    if (!mitarbeiter.length) tb.append(el('tr', {}, el('td', { colspan: 3, class: 'leer', text: 'Noch keine Mitarbeiter.' })));
    for (const m of mitarbeiter) {
      const status = !m.aktiv ? el('span', { class: 'marker', text: 'deaktiviert' }) : m.ausstempelnVergessen ? el('span', { class: 'marker rot', text: 'Ausstempeln vergessen' }) : m.anwesend ? el('span', { class: 'marker gruen', text: 'anwesend' }) : el('span', { class: 'marker', text: 'nicht da' });
      tb.append(el('tr', {},
        el('td', { text: m.name }),
        el('td', {}, status),
        el('td', { class: 'zahl' },
          el('button', { class: 'knopf klein', text: 'Umbenennen', onclick: () => aendereMa(m, 'name') }), ' ',
          el('button', { class: 'knopf klein', text: 'Neue PIN', onclick: () => aendereMa(m, 'pin') }), ' ',
          el('button', { class: 'knopf klein' + (m.aktiv ? ' gefahr' : ''), text: m.aktiv ? 'Deaktivieren' : 'Aktivieren', onclick: () => aendereMa(m, 'aktiv') })
        )
      ));
    }
  }

  async function aendereMa(m, was) {
    let body;
    if (was === 'name') { const n = prompt('Neuer Name', m.name); if (!n) return; body = { name: n }; }
    if (was === 'pin') { const p = prompt(`Neue PIN für ${m.name} (4–6 Ziffern)`); if (!p) return; body = { pin: p }; }
    if (was === 'aktiv') {
      if (m.aktiv && !confirm(`${m.name} deaktivieren? Die bisherigen Zeiten bleiben erhalten.`)) return;
      body = { aktiv: !m.aktiv };
    }
    try { await api(`/api/admin/mitarbeiter/${m.id}`, { method: 'PATCH', body }); meldung('Gespeichert'); await ladeMitarbeiter(); zeigeMitarbeiter(); }
    catch (e) { meldung(e.message, true); }
  }

  $('ma-neu').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/mitarbeiter', { method: 'POST', body: { name: $('ma-name').value, pin: $('ma-pin').value } });
      $('ma-name').value = ''; $('ma-pin').value = '';
      meldung('Mitarbeiter angelegt');
      await ladeMitarbeiter(); zeigeMitarbeiter();
    } catch (err) { meldung(err.message, true); }
  });

  // ---- Stempelungen ----
  $('st-monat').value = diesenMonat();
  $('aw-monat').value = diesenMonat();
  $('nt-zeit').value = lokalesInput(new Date());
  $('st-monat').addEventListener('change', ladeStempel);
  $('st-ma').addEventListener('change', ladeStempel);
  const name = (id) => (mitarbeiter.find((m) => m.id === id) || {}).name || '?';

  async function ladeStempel() {
    const tb = $('st-liste');
    try {
      const q = new URLSearchParams({ monat: $('st-monat').value });
      if ($('st-ma').value) q.set('mitarbeiter', $('st-ma').value);
      const liste = (await api('/api/admin/stempel?' + q)).reverse();
      tb.replaceChildren();
      if (!liste.length) tb.append(el('tr', {}, el('td', { colspan: 7, class: 'leer', text: 'Keine Stempelungen in diesem Monat.' })));
      for (const s of liste) {
        const foto = s.hatFoto ? el('img', { class: 'mini-foto', src: `/api/admin/foto/${s.id}`, loading: 'lazy', alt: 'Foto', onclick: () => grossesFoto(s.id) }) : el('span', { class: 'text-2', text: s.quelle === 'admin' ? 'nachgetragen' : '–' });
        tb.append(el('tr', {},
          el('td', { text: datum(s.zeit) }),
          el('td', { text: uhrzeit(s.zeit) }),
          el('td', { text: name(s.mitarbeiter_id) }),
          el('td', {}, el('span', { class: 'marker ' + (s.typ === 'ein' ? 'gruen' : 'gold'), text: s.typ === 'ein' ? 'Kommen' : 'Gehen' })),
          el('td', {}, foto),
          el('td', { class: 'text-2', text: s.notiz || '' }),
          el('td', { class: 'zahl' },
            el('button', { class: 'knopf klein', text: 'Ändern', onclick: () => aendereStempel(s) }), ' ',
            el('button', { class: 'knopf klein gefahr', text: 'Löschen', onclick: () => loescheStempel(s) })
          )
        ));
      }
    } catch (e) { meldung(e.message, true); }
  }

  async function aendereStempel(s) {
    const neu = prompt(`Neue Zeit für ${name(s.mitarbeiter_id)} (TT.MM.JJJJ HH:MM)`, `${datum(s.zeit)} ${uhrzeit(s.zeit)}`);
    if (!neu) return;
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(neu.trim());
    if (!m) return meldung('Format: TT.MM.JJJJ HH:MM', true);
    const zeit = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
    const notiz = prompt('Grund der Korrektur', s.notiz || '');
    try { await api(`/api/admin/stempel/${s.id}`, { method: 'PATCH', body: { zeit: zeit.toISOString(), notiz: notiz || '' } }); meldung('Korrigiert'); ladeStempel(); }
    catch (e) { meldung(e.message, true); }
  }

  async function loescheStempel(s) {
    if (!confirm(`${s.typ === 'ein' ? 'Kommen' : 'Gehen'} von ${name(s.mitarbeiter_id)} am ${datum(s.zeit)} um ${uhrzeit(s.zeit)} löschen?`)) return;
    try { await api(`/api/admin/stempel/${s.id}`, { method: 'DELETE' }); meldung('Gelöscht'); ladeStempel(); }
    catch (e) { meldung(e.message, true); }
  }

  $('nachtragen').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/stempel', { method: 'POST', body: { mitarbeiterId: Number($('nt-ma').value), typ: $('nt-typ').value, zeit: new Date($('nt-zeit').value).toISOString(), notiz: $('nt-notiz').value } });
      $('nt-notiz').value = '';
      meldung('Nachgetragen');
      ladeStempel();
    } catch (err) { meldung(err.message, true); }
  });

  function grossesFoto(id) { $('gross-foto').src = `/api/admin/foto/${id}`; $('foto-overlay').classList.add('offen'); }
  $('foto-overlay').addEventListener('click', () => $('foto-overlay').classList.remove('offen'));

  // ---- Auswertung ----
  $('aw-monat').addEventListener('change', ladeAuswertung);
  $('export').addEventListener('click', () => { location.href = `/api/admin/export?monat=${encodeURIComponent($('aw-monat').value)}`; });

  async function ladeAuswertung() {
    try {
      const [daten, einst] = await Promise.all([api('/api/admin/auswertung?monat=' + $('aw-monat').value), api('/api/admin/einstellungen')]);
      $('aw-regel').textContent = `Pause: ${einst.pauseMinuten} Min. ab ${einst.pauseAbStunden} Std./Tag`;
      const ue = $('aw-uebersicht');
      const tb = el('tbody');
      for (const m of daten) {
        const offen = m.tage.filter((t) => t.unvollstaendig).length;
        tb.append(el('tr', {}, el('td', { text: m.name }), el('td', { class: 'zahl', text: m.tage.length }), el('td', { class: 'zahl', text: stunden(m.nettoMin) }),
          el('td', {}, offen ? el('span', { class: 'marker rot', text: `${offen}× Gehen fehlt` }) : null)));
      }
      ue.replaceChildren(el('h2', { text: 'Monatsübersicht' }), el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Mitarbeiter' }), el('th', { class: 'zahl', text: 'Tage' }), el('th', { class: 'zahl', text: 'Netto' }), el('th', {}))), tb));

      const details = $('aw-details');
      details.replaceChildren();
      for (const m of daten.filter((x) => x.tage.length)) {
        const body = el('tbody');
        let kw = null;
        const wocheZeile = (k) => { const w = m.wochen.find((x) => x.kw === k); body.append(el('tr', { class: 'summe' }, el('td', { colspan: 6, text: `Summe KW ${k}` }), el('td', { class: 'zahl', text: stunden(w.nettoMin) }))); };
        for (const t of m.tage) {
          if (kw !== null && t.kw !== kw) wocheZeile(kw);
          kw = t.kw;
          body.append(el('tr', {},
            el('td', { text: datumAusSchluessel(t.datum) }), el('td', { text: t.wochentag }),
            el('td', { text: uhrzeit(t.kommen) }),
            el('td', {}, t.gehen ? uhrzeit(t.gehen) + (new Date(t.gehen).toDateString() !== new Date(t.kommen).toDateString() ? ' (+1)' : '') : el('span', { class: 'marker rot', text: 'fehlt' })),
            el('td', { class: 'zahl', text: stunden(t.bruttoMin) }), el('td', { class: 'zahl', text: t.pauseMin ? stunden(t.pauseMin) : '–' }),
            el('td', { class: 'zahl', text: stunden(t.nettoMin) })));
        }
        if (kw !== null) wocheZeile(kw);
        body.append(el('tr', { class: 'summe' }, el('td', { colspan: 6, text: 'Summe Monat' }), el('td', { class: 'zahl', text: stunden(m.nettoMin) })));
        details.append(el('div', { class: 'karte' },
          el('details', {}, el('summary', { text: `${m.name} – ${stunden(m.nettoMin)} Std.` }),
            el('table', {}, el('thead', {}, el('tr', {}, ...['Datum', 'Tag', 'Kommen', 'Gehen'].map((h) => el('th', { text: h })), ...['Brutto', 'Pause', 'Netto'].map((h) => el('th', { class: 'zahl', text: h })))), body))));
      }
    } catch (e) { meldung(e.message, true); }
  }

  // ---- Einstellungen ----
  async function ladeEinstellungen() {
    try {
      const e = await api('/api/admin/einstellungen');
      $('terminal-link').value = e.terminalLink;
      $('regeln').textContent = `Pausenabzug: ${e.pauseMinuten} Minuten, wenn an einem Tag mehr als ${e.pauseAbStunden} Stunden gearbeitet wurde. Fotos werden nach ${e.fotoAufbewahrungTage || '∞'} Tagen automatisch gelöscht.`;
      const p = await api('/api/admin/protokoll');
      const tb = $('protokoll');
      tb.replaceChildren();
      if (!p.length) tb.append(el('tr', {}, el('td', { colspan: 3, class: 'leer', text: 'Noch keine Änderungen.' })));
      for (const x of p) tb.append(el('tr', {}, el('td', { text: `${datum(x.zeit)} ${uhrzeit(x.zeit)}` }), el('td', { text: x.aktion.replace(/_/g, ' ') }), el('td', { class: 'text-2', text: JSON.stringify(x.details) })));
    } catch (err) { meldung(err.message, true); }
  }
  $('link-kopieren').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('terminal-link').value); meldung('Link kopiert'); }
    catch { $('terminal-link').select(); meldung('Bitte manuell kopieren'); }
  });

  // ---- Start ----
  api('/api/admin/status').then((s) => (s.angemeldet ? zeigeApp() : zeigeLogin())).catch(zeigeLogin);
})();

'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const zwei = (n) => String(n).padStart(2, '0');
  const uhrzeit = (d) => `${zwei(d.getHours())}:${zwei(d.getMinutes())}`;

  let mitarbeiter = [];
  let auswahl = null;
  let pin = '';
  let stream = null;
  let sendet = false;
  let schliessTimer = null;

  // ---- Uhr ----
  function tick() {
    const d = new Date();
    $('uhr').textContent = uhrzeit(d);
    $('datum').textContent = `${WOCHENTAGE[d.getDay()]}, ${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`;
  }
  tick();
  setInterval(tick, 1000);

  // ---- Namen ----
  async function ladeNamen() {
    try {
      const r = await fetch('/api/terminal/mitarbeiter', { cache: 'no-store' });
      if (r.status === 403) return location.reload();
      mitarbeiter = await r.json();
      zeigeNamen();
    } catch {
      $('namen').innerHTML = '<div class="leer">Keine Verbindung zum Server – bitte WLAN prüfen.</div>';
    }
  }

  function zeigeNamen() {
    const box = $('namen');
    box.innerHTML = '';
    if (!mitarbeiter.length) {
      box.innerHTML = '<div class="leer">Noch keine Mitarbeiter angelegt.</div>';
      return;
    }
    for (const m of mitarbeiter) {
      const b = document.createElement('button');
      b.className = 'name-kachel' + (m.anwesend ? ' da' : '');
      const seit = m.anwesend && m.seit ? `da seit ${uhrzeit(new Date(m.seit))}` : 'nicht da';
      b.innerHTML = `<span class="n"></span><span class="s"><i class="punkt"></i><span></span></span>`;
      b.querySelector('.n').textContent = m.name;
      b.querySelector('.s span').textContent = seit;
      b.addEventListener('click', () => oeffnePin(m));
      box.appendChild(b);
    }
  }

  ladeNamen();
  setInterval(() => { if (!auswahl) ladeNamen(); }, 30000);

  // ---- Kamera ----
  async function starteKamera() {
    if (stream && stream.active) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      $('kamera').srcObject = stream;
      $('kamera-text').textContent = 'Beim Stempeln wird ein Foto gemacht.';
      return true;
    } catch (e) {
      $('kamera-text').textContent = 'Kamera nicht verfügbar – bitte in den Einstellungen erlauben.';
      return false;
    }
  }

  function machFoto() {
    const v = $('kamera');
    if (!v.videoWidth) return null;
    const c = $('leinwand');
    const breite = 480;
    c.width = breite;
    c.height = Math.round((v.videoHeight / v.videoWidth) * breite);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }

  // ---- PIN ----
  const TASTEN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Abbrechen', '0', 'OK'];
  function baueTasten() {
    const box = $('tasten');
    for (const t of TASTEN) {
      const b = document.createElement('button');
      b.textContent = t === 'OK' ? 'OK' : t;
      if (t === 'Abbrechen') b.className = 'klein';
      if (t === 'OK') { b.className = 'ok'; b.id = 'ok'; }
      b.addEventListener('click', () => taste(t));
      box.appendChild(b);
    }
  }
  baueTasten();

  function zeigePunkte() {
    const box = $('pin-punkte');
    box.innerHTML = '';
    const anzahl = Math.max(4, pin.length);
    for (let i = 0; i < anzahl; i++) {
      const s = document.createElement('span');
      if (i < pin.length) s.className = 'voll';
      box.appendChild(s);
    }
    $('ok').disabled = pin.length < 4 || sendet;
  }

  function unter(text, fehler) {
    $('pin-unter').textContent = text;
    $('pin-unter').classList.toggle('fehler', !!fehler);
  }

  async function oeffnePin(m) {
    auswahl = m;
    pin = '';
    $('pin-name').textContent = m.name;
    unter(m.anwesend ? 'PIN eingeben zum Ausstempeln' : 'PIN eingeben zum Einstempeln');
    zeigePunkte();
    $('pin-overlay').classList.add('offen');
    clearTimeout(schliessTimer);
    schliessTimer = setTimeout(schliessePin, 60000);
    await starteKamera();
  }

  function schliessePin() {
    auswahl = null;
    pin = '';
    $('pin-overlay').classList.remove('offen');
    clearTimeout(schliessTimer);
  }

  function taste(t) {
    if (sendet) return;
    clearTimeout(schliessTimer);
    schliessTimer = setTimeout(schliessePin, 60000);
    if (t === 'Abbrechen') return schliessePin();
    if (t === 'OK') return stempeln();
    if (pin.length < 6) pin += t;
    zeigePunkte();
  }

  async function stempeln() {
    if (pin.length < 4 || !auswahl) return;
    if (!(await starteKamera())) return unter('Ohne Kamera kann nicht gestempelt werden.', true);
    const foto = machFoto();
    if (!foto) return unter('Kamera startet noch – bitte nochmal OK drücken.', true);
    sendet = true;
    zeigePunkte();
    unter('Einen Moment …');
    try {
      const r = await fetch('/api/terminal/stempeln', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mitarbeiterId: auswahl.id, pin, foto }),
      });
      const daten = await r.json().catch(() => ({}));
      if (!r.ok) {
        pin = '';
        unter(daten.fehler || 'Fehler beim Stempeln', true);
        return;
      }
      schliessePin();
      zeigeErgebnis(daten);
      ladeNamen();
    } catch {
      unter('Keine Verbindung – bitte erneut versuchen.', true);
    } finally {
      sendet = false;
      zeigePunkte();
    }
  }

  function zeigeErgebnis(d) {
    const box = $('ergebnis');
    const zeit = new Date(d.zeit);
    const vorname = d.name.split(' ')[0];
    box.className = 'ergebnis ' + d.typ;
    let unterText = 'Eingestempelt';
    if (d.typ === 'aus' && d.dauerMin !== null) {
      unterText = `Ausgestempelt · ${Math.floor(d.dauerMin / 60)} Std. ${zwei(d.dauerMin % 60)} Min. anwesend`;
    } else if (d.typ === 'aus') unterText = 'Ausgestempelt';
    if (d.vergessenSeit) {
      const v = new Date(d.vergessenSeit);
      unterText += ` · Achtung: Ausstempeln am ${v.getDate()}.${v.getMonth() + 1}. vergessen – bitte der Leitung Bescheid geben.`;
    }
    box.innerHTML = `<div class="zeichen">${d.typ === 'ein' ? '→' : '←'}</div><div class="gross"></div><div class="titel"></div><div class="unter"></div>`;
    box.querySelector('.gross').textContent = uhrzeit(zeit);
    box.querySelector('.titel').textContent = d.typ === 'ein' ? `Willkommen, ${vorname}!` : `Schönen Feierabend, ${vorname}!`;
    box.querySelector('.unter').textContent = unterText;
    $('ergebnis-overlay').classList.add('offen');
    setTimeout(() => $('ergebnis-overlay').classList.remove('offen'), d.vergessenSeit ? 8000 : 4000);
  }
  $('ergebnis-overlay').addEventListener('click', () => $('ergebnis-overlay').classList.remove('offen'));

  // Kamera abschalten, wenn die App im Hintergrund ist (iPad-Akku)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    } else if (!document.hidden) {
      ladeNamen();
    }
  });
})();

'use strict';
const path = require('node:path');

process.env.TZ = process.env.TZ || 'Europe/Berlin';

function zahl(name, standard) {
  const v = process.env[name];
  if (v === undefined || v === '') return standard;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} muss eine Zahl sein`);
  return n;
}

const config = {
  port: zahl('PORT', 3000),
  datenOrdner: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  adminPasswort: process.env.ADMIN_PASSWORT || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  terminalSchluessel: process.env.TERMINAL_SCHLUESSEL || '',
  // Pausenregel: ab dieser Tages-Arbeitszeit (Stunden, brutto) werden PAUSE_MINUTEN abgezogen.
  // 0 = Pause wird an jedem Arbeitstag abgezogen.
  pauseMinuten: zahl('PAUSE_MINUTEN', 30),
  pauseAbStunden: zahl('PAUSE_AB_STUNDEN', 6),
  // Ist ein Einstempeln älter als so viele Stunden, gilt das Ausstempeln als vergessen:
  // der nächste Stempel ist dann wieder ein "Kommen" (die offene Schicht wird im Admin markiert).
  maxSchichtStunden: zahl('MAX_SCHICHT_STUNDEN', 16),
  // Fotos werden nach so vielen Tagen automatisch gelöscht (Datenschutz). 0 = nie löschen.
  fotoAufbewahrungTage: zahl('FOTO_AUFBEWAHRUNG_TAGE', 90),
  produktion: process.env.NODE_ENV === 'production',
};

function pruefeConfig() {
  const fehlt = [];
  if (!config.adminPasswort) fehlt.push('ADMIN_PASSWORT');
  if (!config.sessionSecret || config.sessionSecret.length < 32) fehlt.push('SESSION_SECRET (mind. 32 Zeichen)');
  if (!config.terminalSchluessel || config.terminalSchluessel.length < 16) fehlt.push('TERMINAL_SCHLUESSEL (mind. 16 Zeichen)');
  if (fehlt.length) {
    throw new Error('Fehlende Einstellungen in .env: ' + fehlt.join(', '));
  }
}

module.exports = { config, pruefeConfig };

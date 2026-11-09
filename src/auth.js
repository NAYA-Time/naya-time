'use strict';
const crypto = require('node:crypto');

// --- PIN-Hashing (scrypt) ---
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function pruefePin(pin, gespeichert) {
  const [art, saltHex, hashHex] = String(gespeichert).split('$');
  if (art !== 'scrypt') return false;
  const soll = Buffer.from(hashHex, 'hex');
  const ist = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), soll.length);
  return crypto.timingSafeEqual(soll, ist);
}

function gueltigePin(pin) {
  return /^\d{4,6}$/.test(String(pin || ''));
}

// --- Signierte Cookies (ohne zusätzliche Abhängigkeiten) ---
function signiere(wert, secret) {
  const daten = Buffer.from(JSON.stringify(wert)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(daten).digest('base64url');
  return `${daten}.${sig}`;
}

function lese(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [daten, sig] = token.split('.');
  const soll = crypto.createHmac('sha256', secret).update(daten).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(soll);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const wert = JSON.parse(Buffer.from(daten, 'base64url').toString());
    if (wert.ablauf && Date.now() > wert.ablauf) return null;
    return wert;
  } catch {
    return null;
  }
}

function leseCookies(req) {
  const ergebnis = {};
  for (const teil of (req.headers.cookie || '').split(';')) {
    const i = teil.indexOf('=');
    if (i < 0) continue;
    ergebnis[teil.slice(0, i).trim()] = decodeURIComponent(teil.slice(i + 1).trim());
  }
  return ergebnis;
}

function gleich(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { hashPin, pruefePin, gueltigePin, signiere, lese, leseCookies, gleich };

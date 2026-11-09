'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function oeffneDb(datenOrdner) {
  fs.mkdirSync(datenOrdner, { recursive: true });
  const db = new DatabaseSync(path.join(datenOrdner, 'naya-time.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS mitarbeiter (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      pin_hash    TEXT NOT NULL,
      aktiv       INTEGER NOT NULL DEFAULT 1,
      fehlversuche INTEGER NOT NULL DEFAULT 0,
      gesperrt_bis TEXT,
      erstellt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS stempel (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      mitarbeiter_id INTEGER NOT NULL REFERENCES mitarbeiter(id),
      typ           TEXT NOT NULL CHECK (typ IN ('ein','aus')),
      zeit          TEXT NOT NULL,            -- ISO-Zeitpunkt (UTC)
      foto          TEXT,                     -- relativer Pfad im Datenordner
      quelle        TEXT NOT NULL DEFAULT 'terminal' CHECK (quelle IN ('terminal','admin')),
      notiz         TEXT,
      geloescht     INTEGER NOT NULL DEFAULT 0,
      erstellt      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS stempel_ma_zeit ON stempel(mitarbeiter_id, zeit);

    -- Jede Korrektur im Admin wird protokolliert (Nachvollziehbarkeit).
    CREATE TABLE IF NOT EXISTS protokoll (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      zeit      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      aktion    TEXT NOT NULL,
      details   TEXT NOT NULL
    );
  `);
  return db;
}

module.exports = { oeffneDb };

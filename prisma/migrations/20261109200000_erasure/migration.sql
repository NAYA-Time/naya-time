-- Löschkonzept (Gunnar 09.11.2026): Ehemalige Mitarbeiter werden nach Ablauf der Aufbewahrungsfrist
-- nur von Hand gelöscht. Dafür dürfen Rohbuchungen ausnahmsweise gelöscht werden, wenn die Transaktion
-- vorher ausdrücklich "naya.erasure = on" setzt (nur lib/erasure.ts). Ändern bleibt verboten,
-- das Änderungsprotokoll bleibt immer unverändert.
CREATE OR REPLACE FUNCTION naya_forbid_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME <> 'audit_logs' AND current_setting('naya.erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'NAYA TIME: % auf % ist nicht erlaubt (unveränderliche Tabelle)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION naya_photo_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('naya.erasure', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'NAYA TIME: Foto-Datensätze werden nicht gelöscht, nur markiert';
  END IF;
  IF NEW."clockEventId" <> OLD."clockEventId" OR NEW."storageKey" <> OLD."storageKey" OR NEW."sha256" <> OLD."sha256"
     OR NEW."capturedAt" <> OLD."capturedAt" THEN
    RAISE EXCEPTION 'NAYA TIME: Foto-Zuordnung ist unveränderlich';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

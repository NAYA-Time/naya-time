-- Komplett vergessene Schichten können nachgetragen werden (ohne Rohbuchung, mit Korrektur-Datensatz ADD_SESSION)
ALTER TABLE "work_sessions" ALTER COLUMN "clockInEventId" DROP NOT NULL;
-- Einzelrechte pro Person (z. B. nur Inhaber und Melanie dürfen Schichten nachtragen)
ALTER TABLE "admin_users" ADD COLUMN "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

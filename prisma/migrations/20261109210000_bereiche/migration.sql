-- Bereiche (Gunnar 09.11.2026): Küche, Service, Spülküche, Büro als Hauptbereiche, Aushilfen als eigener Reiter
ALTER TYPE "DeptFilter" ADD VALUE IF NOT EXISTS 'SPUELE';
ALTER TYPE "DeptFilter" ADD VALUE IF NOT EXISTS 'BUERO';
ALTER TYPE "DeptFilter" ADD VALUE IF NOT EXISTS 'AUSHILFEN';
ALTER TYPE "EmploymentType" ADD VALUE IF NOT EXISTS 'EXTERN';

INSERT INTO "departments" ("id", "key", "name", "kind", "sortOrder", "active")
VALUES (gen_random_uuid(), 'SPUELE', 'Spülküche', 'MAIN', 3, true)
ON CONFLICT ("key") DO UPDATE SET "kind" = 'MAIN', "parentId" = NULL, "active" = true;

INSERT INTO "departments" ("id", "key", "name", "kind", "sortOrder", "active")
VALUES (gen_random_uuid(), 'BUERO', 'Büro', 'MAIN', 4, true)
ON CONFLICT ("key") DO UPDATE SET "kind" = 'MAIN', "parentId" = NULL, "sortOrder" = 4, "active" = true;

-- Restaurantleitung zählt zum Büro
UPDATE "departments" SET "parentId" = (SELECT "id" FROM "departments" WHERE "key" = 'BUERO') WHERE "key" = 'LEITUNG' AND "parentId" IS NULL;

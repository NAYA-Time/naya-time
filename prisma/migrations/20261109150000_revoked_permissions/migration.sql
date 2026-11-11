ALTER TABLE "admin_users" ADD COLUMN "revokedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "permissions" SET "description" = 'Stundenlöhne der Aushilfen sehen (Festangestellte haben keine Lohndaten im System)' WHERE "key" = 'wages.view';
UPDATE "permissions" SET "description" = 'Stundenlöhne der Aushilfen ändern' WHERE "key" = 'wages.manage';

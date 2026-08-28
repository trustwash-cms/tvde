-- Toggle de sincronização automática diária (Bolt default ON; portais default OFF)

ALTER TABLE "bolt_connections" ADD COLUMN "auto_sync_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "portal_connections" ADD COLUMN "auto_sync_enabled" BOOLEAN NOT NULL DEFAULT false;

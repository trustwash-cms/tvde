-- Módulo Marcações (bookings) — catálogo, agenda e embed público

CREATE TABLE "booking_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "public_slug" TEXT,
    "embed_public_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publish_enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_calendar_id" UUID,
    "slot_interval_min" INTEGER NOT NULL DEFAULT 30,
    "day_start" TEXT NOT NULL DEFAULT '09:00',
    "day_end" TEXT NOT NULL DEFAULT '18:00',
    "closed_weekdays" JSONB NOT NULL DEFAULT '[0]',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_catalog_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "client_id" UUID,
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "source" TEXT NOT NULL DEFAULT 'staff',
    "calendar_event_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_settings_workspace_id_key" ON "booking_settings"("workspace_id");
CREATE UNIQUE INDEX "booking_settings_embed_public_key_key" ON "booking_settings"("embed_public_key");
CREATE INDEX "booking_catalog_items_tenant_id_workspace_id_status_idx" ON "booking_catalog_items"("tenant_id", "workspace_id", "status");
CREATE INDEX "bookings_tenant_id_workspace_id_start_at_idx" ON "bookings"("tenant_id", "workspace_id", "start_at");
CREATE INDEX "bookings_workspace_id_start_at_status_idx" ON "bookings"("workspace_id", "start_at", "status");
CREATE INDEX "bookings_catalog_item_id_idx" ON "bookings"("catalog_item_id");

ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_default_calendar_id_fkey" FOREIGN KEY ("default_calendar_id") REFERENCES "calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "booking_catalog_items" ADD CONSTRAINT "booking_catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_catalog_items" ADD CONSTRAINT "booking_catalog_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "booking_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_calendar_event_id_fkey" FOREIGN KEY ("calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES (
  'bookings',
  'Marcações',
  'Agenda de marcações com catálogo próprio, sync calendário e embed público',
  false,
  '1.0.0'
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "version" = EXCLUDED."version";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'bookings', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", 'bookings', false, NULL
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

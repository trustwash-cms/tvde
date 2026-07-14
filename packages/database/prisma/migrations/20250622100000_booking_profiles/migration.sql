-- Perfis de Marcações por utilizador (multi-calendário) + profile_id em catálogo e bookings

CREATE TABLE "booking_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
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

    CONSTRAINT "booking_profiles_pkey" PRIMARY KEY ("id")
);

INSERT INTO "booking_profiles" (
    "id", "tenant_id", "workspace_id", "owner_user_id", "name",
    "public_slug", "embed_public_key", "publish_enabled", "default_calendar_id",
    "slot_interval_min", "day_start", "day_end", "closed_weekdays", "timezone",
    "created_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    w."tenant_id",
    bs."workspace_id",
    COALESCE(
        (
            SELECT u."id" FROM "users" u
            WHERE u."workspace_id" = bs."workspace_id"
              AND u."role" IN ('superadmin', 'admin')
            ORDER BY u."created_at" ASC
            LIMIT 1
        ),
        (
            SELECT u."id" FROM "users" u
            WHERE u."tenant_id" = w."tenant_id"
              AND u."role" IN ('superadmin', 'admin')
            ORDER BY u."created_at" ASC
            LIMIT 1
        )
    ),
    'Marcações',
    bs."public_slug",
    bs."embed_public_key",
    bs."publish_enabled",
    bs."default_calendar_id",
    bs."slot_interval_min",
    bs."day_start",
    bs."day_end",
    bs."closed_weekdays",
    bs."timezone",
    bs."created_at",
    bs."updated_at"
FROM "booking_settings" bs
JOIN "workspaces" w ON w."id" = bs."workspace_id"
WHERE EXISTS (
    SELECT 1 FROM "users" u
    WHERE u."tenant_id" = w."tenant_id"
      AND u."role" IN ('superadmin', 'admin')
);

ALTER TABLE "booking_catalog_items" ADD COLUMN "profile_id" UUID;
ALTER TABLE "bookings" ADD COLUMN "profile_id" UUID;

UPDATE "booking_catalog_items" bci
SET "profile_id" = bp."id"
FROM "booking_profiles" bp
WHERE bp."workspace_id" = bci."workspace_id";

UPDATE "bookings" b
SET "profile_id" = bp."id"
FROM "booking_profiles" bp
WHERE bp."workspace_id" = b."workspace_id";

DELETE FROM "booking_catalog_items" WHERE "profile_id" IS NULL;
DELETE FROM "bookings" WHERE "profile_id" IS NULL;

ALTER TABLE "booking_catalog_items" ALTER COLUMN "profile_id" SET NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "profile_id" SET NOT NULL;

CREATE UNIQUE INDEX "booking_profiles_workspace_id_owner_user_id_key" ON "booking_profiles"("workspace_id", "owner_user_id");
CREATE UNIQUE INDEX "booking_profiles_public_slug_key" ON "booking_profiles"("public_slug");
CREATE UNIQUE INDEX "booking_profiles_embed_public_key_key" ON "booking_profiles"("embed_public_key");
CREATE INDEX "booking_profiles_tenant_id_workspace_id_idx" ON "booking_profiles"("tenant_id", "workspace_id");
CREATE INDEX "booking_catalog_items_profile_id_status_idx" ON "booking_catalog_items"("profile_id", "status");
CREATE INDEX "bookings_profile_id_start_at_status_idx" ON "bookings"("profile_id", "start_at", "status");

ALTER TABLE "booking_profiles" ADD CONSTRAINT "booking_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_profiles" ADD CONSTRAINT "booking_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_profiles" ADD CONSTRAINT "booking_profiles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_profiles" ADD CONSTRAINT "booking_profiles_default_calendar_id_fkey" FOREIGN KEY ("default_calendar_id") REFERENCES "calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "booking_catalog_items" ADD CONSTRAINT "booking_catalog_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "booking_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "booking_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

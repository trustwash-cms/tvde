-- Módulo Calendário: calendários partilhados, eventos, lembretes, anexos, faturação agendada (fase 2)

-- Enums
CREATE TYPE "CalendarVisibility" AS ENUM ('private', 'workspace', 'shared');
CREATE TYPE "CalendarMemberRole" AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE "CalendarEventStatus" AS ENUM ('confirmed', 'tentative', 'cancelled');
CREATE TYPE "CalendarAttendeeRole" AS ENUM ('organizer', 'required', 'optional');
CREATE TYPE "CalendarAttendeeResponse" AS ENUM ('needs_action', 'accepted', 'declined', 'tentative');
CREATE TYPE "CalendarReminderChannel" AS ENUM ('in_app', 'email', 'push');
CREATE TYPE "CalendarReminderStatus" AS ENUM ('pending', 'sent', 'dismissed', 'skipped');
CREATE TYPE "CalendarScheduledInvoiceStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- Calendars
CREATE TABLE "calendars" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "visibility" "CalendarVisibility" NOT NULL DEFAULT 'private',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_members" (
    "id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CalendarMemberRole" NOT NULL DEFAULT 'viewer',
    "notify_changes" BOOLEAN NOT NULL DEFAULT true,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by_user_id" UUID,

    CONSTRAINT "calendar_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'confirmed',
    "color" TEXT,
    "recurrence_rule" TEXT,
    "recurrence_until" TIMESTAMPTZ(6),
    "series_master_id" UUID,
    "original_start_at" TIMESTAMPTZ(6),
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_event_attendees" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CalendarAttendeeRole" NOT NULL DEFAULT 'required',
    "response_status" "CalendarAttendeeResponse" NOT NULL DEFAULT 'needs_action',
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invited_by_user_id" UUID,

    CONSTRAINT "calendar_event_attendees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_event_reminders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "channel" "CalendarReminderChannel" NOT NULL DEFAULT 'in_app',
    "fire_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "CalendarReminderStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_reminders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_event_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_scheduled_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "event_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "billing_entity_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "CalendarScheduledInvoiceStatus" NOT NULL DEFAULT 'pending',
    "draft_payload_json" JSONB NOT NULL,
    "invoice_id" UUID,
    "processed_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_scheduled_invoices_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "calendars_tenant_id_workspace_id_idx" ON "calendars"("tenant_id", "workspace_id");
CREATE INDEX "calendars_owner_user_id_idx" ON "calendars"("owner_user_id");
CREATE UNIQUE INDEX "calendar_members_calendar_id_user_id_key" ON "calendar_members"("calendar_id", "user_id");
CREATE INDEX "calendar_members_user_id_idx" ON "calendar_members"("user_id");
CREATE INDEX "calendar_events_calendar_id_start_at_end_at_idx" ON "calendar_events"("calendar_id", "start_at", "end_at");
CREATE INDEX "calendar_events_tenant_id_workspace_id_start_at_idx" ON "calendar_events"("tenant_id", "workspace_id", "start_at");
CREATE INDEX "calendar_events_series_master_id_idx" ON "calendar_events"("series_master_id");
CREATE UNIQUE INDEX "calendar_event_attendees_event_id_user_id_key" ON "calendar_event_attendees"("event_id", "user_id");
CREATE INDEX "calendar_event_attendees_user_id_idx" ON "calendar_event_attendees"("user_id");
CREATE INDEX "calendar_event_reminders_user_id_fire_at_status_idx" ON "calendar_event_reminders"("user_id", "fire_at", "status");
CREATE INDEX "calendar_event_reminders_event_id_idx" ON "calendar_event_reminders"("event_id");
CREATE INDEX "calendar_event_reminders_tenant_id_status_fire_at_idx" ON "calendar_event_reminders"("tenant_id", "status", "fire_at");
CREATE INDEX "calendar_event_attachments_event_id_idx" ON "calendar_event_attachments"("event_id");
CREATE INDEX "calendar_event_attachments_tenant_id_idx" ON "calendar_event_attachments"("tenant_id");
CREATE INDEX "calendar_scheduled_invoices_scheduled_at_status_idx" ON "calendar_scheduled_invoices"("scheduled_at", "status");
CREATE INDEX "calendar_scheduled_invoices_tenant_id_workspace_id_idx" ON "calendar_scheduled_invoices"("tenant_id", "workspace_id");
CREATE INDEX "calendar_scheduled_invoices_event_id_idx" ON "calendar_scheduled_invoices"("event_id");

-- Foreign keys
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_series_master_id_fkey" FOREIGN KEY ("series_master_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendar_event_attachments" ADD CONSTRAINT "calendar_event_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_event_attachments" ADD CONSTRAINT "calendar_event_attachments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_event_attachments" ADD CONSTRAINT "calendar_event_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendar_scheduled_invoices" ADD CONSTRAINT "calendar_scheduled_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_scheduled_invoices" ADD CONSTRAINT "calendar_scheduled_invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_scheduled_invoices" ADD CONSTRAINT "calendar_scheduled_invoices_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_scheduled_invoices" ADD CONSTRAINT "calendar_scheduled_invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_scheduled_invoices" ADD CONSTRAINT "calendar_scheduled_invoices_billing_entity_id_fkey" FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_scheduled_invoices" ADD CONSTRAINT "calendar_scheduled_invoices_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Module registry (disabled by default — MASTER autoriza por tenant)
INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES (
  'calendar',
  'Calendário',
  'Agenda partilhada, lembretes, anexos e agendamento de faturação',
  false,
  '1.0.0'
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'calendar', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", 'calendar', false, NULL
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

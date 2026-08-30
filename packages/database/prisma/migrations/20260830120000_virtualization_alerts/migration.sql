-- CreateTable
CREATE TABLE IF NOT EXISTS "virtualization_alert_incidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "fingerprint" VARCHAR(400) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "title" VARCHAR(300) NOT NULL,
    "message" TEXT NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_id" UUID,
    "source_label" VARCHAR(200) NOT NULL,
    "metric_value" DOUBLE PRECISION,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "last_notified_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "silenced_until" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_alert_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "virtualization_alert_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "destination" VARCHAR(255),
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtualization_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "virtualization_alert_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "snapshot_key" VARCHAR(400) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_alert_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "virtualization_alert_incidents_workspace_id_fingerprint_key"
  ON "virtualization_alert_incidents"("workspace_id", "fingerprint");

CREATE INDEX IF NOT EXISTS "virtualization_alert_incidents_workspace_id_status_last_seen_at_idx"
  ON "virtualization_alert_incidents"("workspace_id", "status", "last_seen_at");

CREATE INDEX IF NOT EXISTS "virtualization_alert_incidents_tenant_id_workspace_id_idx"
  ON "virtualization_alert_incidents"("tenant_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "virtualization_alert_events_incident_id_created_at_idx"
  ON "virtualization_alert_events"("incident_id", "created_at");

CREATE INDEX IF NOT EXISTS "virtualization_alert_events_workspace_id_created_at_idx"
  ON "virtualization_alert_events"("workspace_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "virtualization_alert_snapshots_workspace_id_snapshot_key_key"
  ON "virtualization_alert_snapshots"("workspace_id", "snapshot_key");

CREATE INDEX IF NOT EXISTS "virtualization_alert_snapshots_workspace_id_idx"
  ON "virtualization_alert_snapshots"("workspace_id");

ALTER TABLE "virtualization_alert_incidents"
  ADD CONSTRAINT "virtualization_alert_incidents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "virtualization_alert_incidents"
  ADD CONSTRAINT "virtualization_alert_incidents_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "virtualization_alert_events"
  ADD CONSTRAINT "virtualization_alert_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "virtualization_alert_events"
  ADD CONSTRAINT "virtualization_alert_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "virtualization_alert_events"
  ADD CONSTRAINT "virtualization_alert_events_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "virtualization_alert_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "virtualization_alert_snapshots"
  ADD CONSTRAINT "virtualization_alert_snapshots_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "virtualization_alert_snapshots"
  ADD CONSTRAINT "virtualization_alert_snapshots_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

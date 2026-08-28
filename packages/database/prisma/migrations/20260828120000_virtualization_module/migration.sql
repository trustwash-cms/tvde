-- Virtualização module (Proxmox VE / PBS)

CREATE TABLE "virtualization_pbs_servers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "base_url" VARCHAR(500) NOT NULL,
    "datastore" VARCHAR(120) NOT NULL,
    "encrypted_api_token" TEXT NOT NULL,
    "verify_ssl" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_pbs_servers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "virtualization_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "notify_on_backup_failure" BOOLEAN NOT NULL DEFAULT true,
    "notify_whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "notify_whatsapp_phones" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "notify_email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "notify_email_addresses" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "poll_interval_minutes" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "virtualization_pbs_servers_tenant_id_workspace_id_idx" ON "virtualization_pbs_servers"("tenant_id", "workspace_id");
CREATE INDEX "virtualization_pbs_servers_workspace_id_sort_order_idx" ON "virtualization_pbs_servers"("workspace_id", "sort_order");
CREATE UNIQUE INDEX "virtualization_settings_workspace_id_key" ON "virtualization_settings"("workspace_id");

ALTER TABLE "virtualization_pbs_servers" ADD CONSTRAINT "virtualization_pbs_servers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_pbs_servers" ADD CONSTRAINT "virtualization_pbs_servers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_settings" ADD CONSTRAINT "virtualization_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_settings" ADD CONSTRAINT "virtualization_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "version", "description", "is_core")
VALUES (
  'virtualization',
  'Virtualização',
  '1.0.0',
  'Monitorização Proxmox VE e Proxmox Backup Server',
  false
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'virtualization', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at", "config_json")
SELECT gen_random_uuid(), w."id", 'virtualization', false, NULL, '{}'::jsonb
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

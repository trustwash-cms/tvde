-- Billing entities layer (CRM ↔ Moloni)

CREATE TABLE "billing_entities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vat" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address_json" JSONB NOT NULL DEFAULT '{}',
    "provider" TEXT NOT NULL DEFAULT 'moloni',
    "external_id" TEXT,
    "cms_client_id" UUID,
    "link_status" TEXT NOT NULL DEFAULT 'unlinked',
    "sync_status" TEXT NOT NULL DEFAULT 'synced',
    "moloni_updated_at" TIMESTAMP(3),
    "cms_updated_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "moloni_payload_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_sync_conflicts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "cms_client_id" UUID,
    "field" TEXT NOT NULL,
    "cms_value" TEXT,
    "moloni_value" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_sync_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_catalog_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "catalog_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data_json" JSONB NOT NULL DEFAULT '{}',
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_catalog_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoices" ADD COLUMN "billing_entity_id" UUID;
ALTER TABLE "invoices" ALTER COLUMN "client_id" DROP NOT NULL;

-- Backfill billing_entities from existing CRM clients
INSERT INTO "billing_entities" (
    "id", "tenant_id", "workspace_id", "entity_type", "name", "vat", "email", "phone",
    "address_json", "provider", "external_id", "cms_client_id", "link_status", "sync_status",
    "last_synced_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    c."tenant_id",
    c."workspace_id",
    'customer',
    c."name",
    c."nif",
    c."email",
    c."phone",
    c."address_json",
    COALESCE(c."billing_provider", 'moloni'),
    c."external_customer_id",
    c."id",
    CASE
        WHEN c."external_customer_id" IS NOT NULL THEN 'linked'
        ELSE 'unlinked'
    END,
    'synced',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "clients" c;

-- Link existing invoices to billing entities via client_id
UPDATE "invoices" i
SET "billing_entity_id" = be."id"
FROM "billing_entities" be
WHERE be."cms_client_id" = i."client_id"
  AND i."billing_entity_id" IS NULL;

CREATE UNIQUE INDEX "billing_entities_cms_client_id_key" ON "billing_entities"("cms_client_id");
CREATE UNIQUE INDEX "billing_entities_workspace_provider_entity_external_key"
    ON "billing_entities"("workspace_id", "provider", "entity_type", "external_id");
CREATE INDEX "billing_entities_tenant_id_workspace_id_idx" ON "billing_entities"("tenant_id", "workspace_id");
CREATE INDEX "billing_entities_workspace_id_entity_type_idx" ON "billing_entities"("workspace_id", "entity_type");

CREATE INDEX "billing_sync_conflicts_workspace_id_status_idx" ON "billing_sync_conflicts"("workspace_id", "status");
CREATE INDEX "billing_sync_conflicts_entity_id_idx" ON "billing_sync_conflicts"("entity_id");

CREATE UNIQUE INDEX "billing_catalog_items_workspace_catalog_external_key"
    ON "billing_catalog_items"("workspace_id", "catalog_type", "external_id");
CREATE INDEX "billing_catalog_items_workspace_id_catalog_type_idx"
    ON "billing_catalog_items"("workspace_id", "catalog_type");

CREATE INDEX "invoices_billing_entity_id_idx" ON "invoices"("billing_entity_id");

ALTER TABLE "billing_entities" ADD CONSTRAINT "billing_entities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_entities" ADD CONSTRAINT "billing_entities_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_entities" ADD CONSTRAINT "billing_entities_cms_client_id_fkey"
    FOREIGN KEY ("cms_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_sync_conflicts" ADD CONSTRAINT "billing_sync_conflicts_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_sync_conflicts" ADD CONSTRAINT "billing_sync_conflicts_entity_id_fkey"
    FOREIGN KEY ("entity_id") REFERENCES "billing_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_catalog_items" ADD CONSTRAINT "billing_catalog_items_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_entity_id_fkey"
    FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

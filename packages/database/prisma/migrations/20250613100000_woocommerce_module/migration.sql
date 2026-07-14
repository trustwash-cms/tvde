-- Módulo WooCommerce: ligação API por workspace (isolado — sem dependências de billing/calendar)

CREATE TABLE "woocommerce_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "store_url" TEXT NOT NULL,
    "consumer_key" TEXT NOT NULL,
    "encrypted_consumer_secret" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "woocommerce_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "woocommerce_connections_workspace_id_key" ON "woocommerce_connections"("workspace_id");

ALTER TABLE "woocommerce_connections" ADD CONSTRAINT "woocommerce_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES (
  'woocommerce',
  'WooCommerce',
  'Gestão de produtos e serviços WordPress/WooCommerce via REST API',
  false,
  '1.0.0'
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'woocommerce', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", 'woocommerce', false, NULL
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

-- Módulo Shopify: ligação Admin API por workspace (isolado)

CREATE TABLE "shopify_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "api_version" TEXT NOT NULL DEFAULT '2025-01',
    "encrypted_access_token" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_connections_workspace_id_key" ON "shopify_connections"("workspace_id");

ALTER TABLE "shopify_connections" ADD CONSTRAINT "shopify_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES (
  'shopify',
  'Shopify',
  'Produtos, clientes, encomendas e pagamentos via Shopify Admin API',
  false,
  '1.0.0'
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'shopify', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", 'shopify', false, NULL
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

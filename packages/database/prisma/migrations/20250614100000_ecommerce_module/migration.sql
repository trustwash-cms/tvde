-- Módulo eCommerce — catálogo local por workspace (isolado de billing/products/woocommerce)

CREATE TABLE "ecommerce_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "store_title" TEXT NOT NULL DEFAULT 'Loja',
    "public_slug" TEXT,
    "embed_public_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publish_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ecommerce_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "short_description" TEXT,
    "sku" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "compare_at_price" DECIMAL(12,2),
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ecommerce_settings_workspace_id_key" ON "ecommerce_settings"("workspace_id");
CREATE UNIQUE INDEX "ecommerce_settings_embed_public_key_key" ON "ecommerce_settings"("embed_public_key");
CREATE UNIQUE INDEX "ecommerce_products_workspace_id_slug_key" ON "ecommerce_products"("workspace_id", "slug");
CREATE INDEX "ecommerce_products_tenant_id_workspace_id_status_idx" ON "ecommerce_products"("tenant_id", "workspace_id", "status");

ALTER TABLE "ecommerce_settings" ADD CONSTRAINT "ecommerce_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES (
  'ecommerce',
  'eCommerce',
  'Catálogo de loja online — criar no CMS, exportar para sites externos (script/iframe)',
  false,
  '1.0.0'
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "version" = EXCLUDED."version";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'ecommerce', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", 'ecommerce', false, NULL
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

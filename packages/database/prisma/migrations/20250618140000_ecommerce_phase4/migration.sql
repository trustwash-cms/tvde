-- Fase 4: categorias, notas encomenda, URL retorno checkout

CREATE TABLE IF NOT EXISTS "ecommerce_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ecommerce_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_categories_workspace_id_slug_key"
    ON "ecommerce_categories"("workspace_id", "slug");

CREATE INDEX IF NOT EXISTS "ecommerce_categories_tenant_id_workspace_id_idx"
    ON "ecommerce_categories"("tenant_id", "workspace_id");

DO $$ BEGIN
    ALTER TABLE "ecommerce_categories" ADD CONSTRAINT "ecommerce_categories_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ecommerce_categories" ADD CONSTRAINT "ecommerce_categories_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "category_id" UUID;

DO $$ BEGIN
    ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_category_id_fkey"
        FOREIGN KEY ("category_id") REFERENCES "ecommerce_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ecommerce_products_category_id_idx" ON "ecommerce_products"("category_id");

ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "internal_notes" TEXT;
ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "shipped_at" TIMESTAMP(3);

ALTER TABLE "ecommerce_settings" ADD COLUMN IF NOT EXISTS "checkout_return_url" TEXT;

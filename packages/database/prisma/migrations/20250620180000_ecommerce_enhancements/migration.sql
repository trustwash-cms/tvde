-- Produto: características, IVA, destaque home, marca/modelo
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "characteristics" TEXT;
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "price_ex_vat" DECIMAL(12,4);
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 23;
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "featured_on_home" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ecommerce_brands" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecommerce_brands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ecommerce_models" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "brand_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecommerce_models_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "brand_id" UUID;
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "model_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_brands_workspace_id_slug_key" ON "ecommerce_brands"("workspace_id", "slug");
CREATE INDEX IF NOT EXISTS "ecommerce_brands_tenant_id_workspace_id_idx" ON "ecommerce_brands"("tenant_id", "workspace_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_models_workspace_id_slug_key" ON "ecommerce_models"("workspace_id", "slug");
CREATE INDEX IF NOT EXISTS "ecommerce_models_brand_id_idx" ON "ecommerce_models"("brand_id");
CREATE INDEX IF NOT EXISTS "ecommerce_models_tenant_id_workspace_id_idx" ON "ecommerce_models"("tenant_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "ecommerce_products_brand_id_idx" ON "ecommerce_products"("brand_id");
CREATE INDEX IF NOT EXISTS "ecommerce_products_model_id_idx" ON "ecommerce_products"("model_id");

DO $$ BEGIN
  ALTER TABLE "ecommerce_brands" ADD CONSTRAINT "ecommerce_brands_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_brands" ADD CONSTRAINT "ecommerce_brands_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_models" ADD CONSTRAINT "ecommerce_models_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_models" ADD CONSTRAINT "ecommerce_models_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_models" ADD CONSTRAINT "ecommerce_models_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "ecommerce_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "ecommerce_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_model_id_fkey"
    FOREIGN KEY ("model_id") REFERENCES "ecommerce_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Navegação tipo OpenCart (itens de menu)
CREATE TABLE IF NOT EXISTS "ecommerce_nav_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "parent_id" UUID,
  "label" TEXT NOT NULL,
  "link_type" TEXT NOT NULL DEFAULT 'url',
  "link_target" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecommerce_nav_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ecommerce_nav_items_workspace_id_sort_order_idx" ON "ecommerce_nav_items"("workspace_id", "sort_order");
CREATE INDEX IF NOT EXISTS "ecommerce_nav_items_parent_id_idx" ON "ecommerce_nav_items"("parent_id");

DO $$ BEGIN
  ALTER TABLE "ecommerce_nav_items" ADD CONSTRAINT "ecommerce_nav_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_nav_items" ADD CONSTRAINT "ecommerce_nav_items_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ecommerce_nav_items" ADD CONSTRAINT "ecommerce_nav_items_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "ecommerce_nav_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Envio (Shippix futuro)
ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "shipping_cents" INTEGER NOT NULL DEFAULT 0;

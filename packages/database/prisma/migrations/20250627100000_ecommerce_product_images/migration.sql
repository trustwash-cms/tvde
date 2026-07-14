-- Imagens de produtos eCommerce (upload + ordem; a 1ª é a principal nos cards)

CREATE TABLE IF NOT EXISTS "ecommerce_product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_product_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ecommerce_product_images_product_id_sort_order_idx"
    ON "ecommerce_product_images"("product_id", "sort_order");
CREATE INDEX IF NOT EXISTS "ecommerce_product_images_workspace_id_idx"
    ON "ecommerce_product_images"("workspace_id");

DO $$ BEGIN
    ALTER TABLE "ecommerce_product_images" ADD CONSTRAINT "ecommerce_product_images_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ecommerce_product_images" ADD CONSTRAINT "ecommerce_product_images_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ecommerce_product_images" ADD CONSTRAINT "ecommerce_product_images_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "ecommerce_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

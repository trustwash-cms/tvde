-- Biblioteca de media eCommerce (banners, ícones, wireframe)

CREATE TABLE IF NOT EXISTS "ecommerce_media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "label" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "has_alpha" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ecommerce_media_assets_workspace_id_created_at_idx"
    ON "ecommerce_media_assets"("workspace_id", "created_at" DESC);

DO $$ BEGIN
    ALTER TABLE "ecommerce_media_assets" ADD CONSTRAINT "ecommerce_media_assets_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ecommerce_media_assets" ADD CONSTRAINT "ecommerce_media_assets_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

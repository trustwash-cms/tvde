-- Segunda loja (Rappod) — storefront + tema de email por workspace
ALTER TABLE "ecommerce_settings" ADD COLUMN IF NOT EXISTS "storefront_id" TEXT NOT NULL DEFAULT 'arc';
ALTER TABLE "ecommerce_settings" ADD COLUMN IF NOT EXISTS "email_theme" TEXT NOT NULL DEFAULT 'arc';

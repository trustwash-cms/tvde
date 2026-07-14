-- URL pública da loja (configurável no painel eCommerce)
ALTER TABLE "ecommerce_settings" ADD COLUMN IF NOT EXISTS "storefront_public_url" TEXT;

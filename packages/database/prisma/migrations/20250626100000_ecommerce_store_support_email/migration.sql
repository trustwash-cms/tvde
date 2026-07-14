-- Email de apoio no rodapé dos emails transacionais da loja (por workspace)
ALTER TABLE "ecommerce_settings" ADD COLUMN IF NOT EXISTS "store_support_email" TEXT;

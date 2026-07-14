-- Páginas especiais editáveis por workspace (contacto, privacidade, cookies, etc.)
ALTER TABLE "ecommerce_settings"
ADD COLUMN IF NOT EXISTS "special_pages_config" JSONB;

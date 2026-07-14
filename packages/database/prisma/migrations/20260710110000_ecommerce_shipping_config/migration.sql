-- Configuração de portes (escalões, envio grátis) por loja

ALTER TABLE "ecommerce_settings"
  ADD COLUMN IF NOT EXISTS "shipping_config" JSONB;

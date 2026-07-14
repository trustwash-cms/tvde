-- Marca encomendas com cotação de portes aplicada no checkout

ALTER TABLE "ecommerce_orders"
  ADD COLUMN IF NOT EXISTS "shipping_quoted_at" TIMESTAMPTZ;

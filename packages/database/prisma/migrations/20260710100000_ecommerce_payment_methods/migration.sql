-- Métodos de pagamento configuráveis por loja (Stripe, transferência bancária, …)

ALTER TABLE "ecommerce_settings"
  ADD COLUMN IF NOT EXISTS "payment_methods_config" JSONB;

ALTER TABLE "ecommerce_orders"
  ADD COLUMN IF NOT EXISTS "payment_method" TEXT;

-- Repara drift: migration 20250617120000 pode estar marcada como aplicada sem ter corrido na totalidade
-- (ordem histórica vs criação da tabela stripe_payment_requests). Tudo idempotente.

ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "stripe_payment_request_id" UUID;

ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'standalone';
ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "source_id" TEXT;
ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "source_label" TEXT;
ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "stripe_payment_requests_tenant_id_workspace_id_source_type_created_at_idx"
  ON "stripe_payment_requests"("tenant_id", "workspace_id", "source_type", "created_at");

-- Preço catálogo CarModule (4 casas) — seguro se já estiver DECIMAL(12,4)
ALTER TABLE "carwash_catalog_items"
  ALTER COLUMN "price" TYPE DECIMAL(12, 4);

-- FK ecommerce → stripe (ecommerce_orders pode existir antes do módulo Stripe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stripe_payment_requests'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ecommerce_orders'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ecommerce_orders_stripe_payment_request_id_fkey'
  ) THEN
    ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_stripe_payment_request_id_fkey"
      FOREIGN KEY ("stripe_payment_request_id") REFERENCES "stripe_payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

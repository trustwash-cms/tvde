-- Stripe: origem do link (FO, fatura, isolado) + cancelamento; FO → payment request
-- Nota: stripe_payment_requests só existe a partir de 20250625100000_stripe_module.
-- Alterações idempotentes também em 20250625110000_stripe_schema_repair.

ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "stripe_payment_request_id" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stripe_payment_requests'
  ) THEN
    ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'standalone';
    ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "source_id" TEXT;
    ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "source_label" TEXT;
    ALTER TABLE "stripe_payment_requests" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);

    CREATE INDEX IF NOT EXISTS "stripe_payment_requests_tenant_id_workspace_id_source_type_created_at_idx"
      ON "stripe_payment_requests"("tenant_id", "workspace_id", "source_type", "created_at");
  END IF;
END $$;

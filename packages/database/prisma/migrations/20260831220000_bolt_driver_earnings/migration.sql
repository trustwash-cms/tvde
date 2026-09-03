-- Bolt: CSV «Ganhos por motorista» (líquidos oficiais Fleet) para pagamentos
CREATE TABLE "bolt_driver_earnings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "driver_uuid" TEXT NOT NULL,
    "driver_name" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "gross_total" DECIMAL(12,2),
    "tips" DECIMAL(12,2),
    "cancellation_fees" DECIMAL(12,2),
    "source_filename" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "payment_date" TIMESTAMP(3),
    "imported_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bolt_driver_earnings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bolt_driver_earnings_tenant_driver_period_key"
  ON "bolt_driver_earnings"("tenant_id", "driver_uuid", "period_start", "period_end");

CREATE INDEX "bolt_driver_earnings_tenant_id_period_start_period_end_idx"
  ON "bolt_driver_earnings"("tenant_id", "period_start", "period_end");

CREATE INDEX "bolt_driver_earnings_tenant_id_is_paid_idx"
  ON "bolt_driver_earnings"("tenant_id", "is_paid");

ALTER TABLE "bolt_driver_earnings"
  ADD CONSTRAINT "bolt_driver_earnings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bolt_driver_earnings"
  ADD CONSTRAINT "bolt_driver_earnings_imported_by_user_id_fkey"
  FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_reports"
  ADD COLUMN IF NOT EXISTS "bolt_earning_ids" JSONB NOT NULL DEFAULT '[]';

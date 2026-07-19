-- CreateTable
CREATE TABLE "payment_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "receitas_uber" DECIMAL(12,2) NOT NULL,
    "receitas_bolt" DECIMAL(12,2) NOT NULL,
    "despesas_via_verde" DECIMAL(12,2) NOT NULL,
    "despesas_eletricidade" DECIMAL(12,2) NOT NULL,
    "despesas_combustivel" DECIMAL(12,2) NOT NULL,
    "despesas_comissao" DECIMAL(12,2) NOT NULL,
    "despesas_iva6" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "despesas_conta_corrente" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "resultado_final" DECIMAL(12,2) NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "payment_method" VARCHAR(5),
    "via_verde_movement_ids" JSONB NOT NULL DEFAULT '[]',
    "electricity_charge_ids" JSONB NOT NULL DEFAULT '[]',
    "fuel_transaction_ids" JSONB NOT NULL DEFAULT '[]',
    "uber_payment_ids" JSONB NOT NULL DEFAULT '[]',
    "driver_expense_ids" JSONB NOT NULL DEFAULT '[]',
    "details_json" JSONB,
    "warnings_json" JSONB,
    "report_html" TEXT,
    "created_by_user_id" UUID,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_reports_tenant_id_user_id_created_at_idx" ON "payment_reports"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_reports_tenant_id_period_start_period_end_idx" ON "payment_reports"("tenant_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "payment_reports_tenant_id_is_paid_idx" ON "payment_reports"("tenant_id", "is_paid");

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

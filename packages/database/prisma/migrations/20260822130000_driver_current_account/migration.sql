-- Conta corrente dos motoristas (créditos/débitos ocasionais)

CREATE TYPE "DriverCurrentAccountEntryType" AS ENUM ('credit', 'debit');
CREATE TYPE "DriverCurrentAccountEntryStatus" AS ENUM ('open', 'settled', 'cancelled');

CREATE TABLE "driver_current_account_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID,
    "driver_user_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "DriverCurrentAccountEntryType" NOT NULL,
    "category" VARCHAR(120),
    "reference" VARCHAR(255),
    "status" "DriverCurrentAccountEntryStatus" NOT NULL DEFAULT 'open',
    "installment_enabled" BOOLEAN NOT NULL DEFAULT false,
    "total_installments" INTEGER,
    "installment_amount" DECIMAL(12,2),
    "installments_paid" INTEGER NOT NULL DEFAULT 0,
    "attachment_file_name" TEXT,
    "attachment_storage_key" TEXT,
    "attachment_mime_type" TEXT,
    "attachment_size_bytes" BIGINT,
    "payment_report_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_current_account_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_current_account_entries_tenant_id_driver_user_id_status_idx"
  ON "driver_current_account_entries"("tenant_id", "driver_user_id", "status");
CREATE INDEX "driver_current_account_entries_tenant_id_status_created_at_idx"
  ON "driver_current_account_entries"("tenant_id", "status", "created_at");
CREATE INDEX "driver_current_account_entries_tenant_id_created_at_idx"
  ON "driver_current_account_entries"("tenant_id", "created_at");

ALTER TABLE "driver_current_account_entries"
  ADD CONSTRAINT "driver_current_account_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_current_account_entries"
  ADD CONSTRAINT "driver_current_account_entries_driver_user_id_fkey"
  FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_current_account_entries"
  ADD CONSTRAINT "driver_current_account_entries_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

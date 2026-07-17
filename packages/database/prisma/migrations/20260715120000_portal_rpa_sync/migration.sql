-- CreateEnum
CREATE TYPE "PortalKind" AS ENUM ('via_verde', 'myprio', 'uber');

-- CreateEnum
CREATE TYPE "PortalConnectionStatus" AS ENUM ('disconnected', 'connected', 'awaiting_otp', 'expired', 'error');

-- CreateEnum
CREATE TYPE "PortalJobStatus" AS ENUM ('pending', 'running', 'awaiting_otp', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PortalJobType" AS ENUM ('connect', 'sync', 'refresh');

-- CreateTable
CREATE TABLE "portal_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "portal" "PortalKind" NOT NULL,
    "username_encrypted" TEXT,
    "password_encrypted" TEXT,
    "session_state_encrypted" TEXT,
    "status" "PortalConnectionStatus" NOT NULL DEFAULT 'disconnected',
    "last_login_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "active_job_id" UUID,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sync_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "portal" "PortalKind" NOT NULL,
    "type" "PortalJobType" NOT NULL,
    "status" "PortalJobStatus" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "result_json" JSONB,
    "otp_hint" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "user_vehicle_id" UUID,
    "station" TEXT,
    "charge_date" TIMESTAMP(3) NOT NULL,
    "card_number" TEXT,
    "card_description" TEXT,
    "liters" DECIMAL(12,3),
    "fuel_type" TEXT,
    "receipt_number" TEXT,
    "total_with_vat" DECIMAL(12,2) NOT NULL,
    "client_name" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "payment_date" TIMESTAMP(3),
    "imported_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uber_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "driver_uuid" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "report_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transaction_uuid" TEXT,
    "description" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "payment_date" TIMESTAMP(3),
    "imported_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uber_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_connections_tenant_id_portal_key" ON "portal_connections"("tenant_id", "portal");

-- CreateIndex
CREATE INDEX "portal_connections_tenant_id_idx" ON "portal_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "portal_connections_status_idx" ON "portal_connections"("status");

-- CreateIndex
CREATE INDEX "portal_sync_jobs_tenant_id_portal_idx" ON "portal_sync_jobs"("tenant_id", "portal");

-- CreateIndex
CREATE INDEX "portal_sync_jobs_connection_id_status_idx" ON "portal_sync_jobs"("connection_id", "status");

-- CreateIndex
CREATE INDEX "fuel_transactions_tenant_id_charge_date_idx" ON "fuel_transactions"("tenant_id", "charge_date");

-- CreateIndex
CREATE INDEX "fuel_transactions_tenant_id_is_paid_idx" ON "fuel_transactions"("tenant_id", "is_paid");

-- CreateIndex
CREATE INDEX "fuel_transactions_tenant_id_card_number_idx" ON "fuel_transactions"("tenant_id", "card_number");

-- CreateIndex
CREATE INDEX "fuel_transactions_tenant_id_receipt_number_idx" ON "fuel_transactions"("tenant_id", "receipt_number");

-- CreateIndex
CREATE INDEX "uber_payments_tenant_id_report_date_idx" ON "uber_payments"("tenant_id", "report_date");

-- CreateIndex
CREATE INDEX "uber_payments_tenant_id_driver_uuid_idx" ON "uber_payments"("tenant_id", "driver_uuid");

-- CreateIndex
CREATE INDEX "uber_payments_tenant_id_is_paid_idx" ON "uber_payments"("tenant_id", "is_paid");

-- CreateIndex
CREATE UNIQUE INDEX "uber_payments_tenant_id_driver_uuid_report_date_amount_key" ON "uber_payments"("tenant_id", "driver_uuid", "report_date", "amount");

-- AddForeignKey
ALTER TABLE "portal_connections" ADD CONSTRAINT "portal_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sync_jobs" ADD CONSTRAINT "portal_sync_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sync_jobs" ADD CONSTRAINT "portal_sync_jobs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "portal_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_user_vehicle_id_fkey" FOREIGN KEY ("user_vehicle_id") REFERENCES "user_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uber_payments" ADD CONSTRAINT "uber_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uber_payments" ADD CONSTRAINT "uber_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uber_payments" ADD CONSTRAINT "uber_payments_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

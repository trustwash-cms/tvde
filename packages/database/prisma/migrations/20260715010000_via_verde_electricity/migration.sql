-- CreateTable
CREATE TABLE "via_verde_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "user_vehicle_id" UUID,
    "license_plate" TEXT NOT NULL,
    "iai" TEXT,
    "obu" TEXT NOT NULL,
    "service_code" TEXT,
    "service_description" TEXT,
    "market_code" TEXT,
    "market_description" TEXT,
    "entry_date" TIMESTAMP(3),
    "exit_date" TIMESTAMP(3),
    "entry_point" TEXT,
    "exit_point" TEXT,
    "value" DECIMAL(12,2) NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "payment_date" TIMESTAMP(3),
    "contract_number" TEXT,
    "liquid_value" DECIMAL(12,2),
    "discount_balance" DECIMAL(12,2),
    "mobility_account" TEXT,
    "payment_method" TEXT,
    "system_entry_date" TIMESTAMP(3),
    "imported_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "via_verde_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "electricity_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "user_vehicle_id" UUID,
    "charge_external_id" TEXT,
    "charge_date" DATE NOT NULL,
    "card_number" TEXT,
    "name" TEXT,
    "license_plate" TEXT,
    "station" TEXT,
    "energy_kwh" DECIMAL(12,3),
    "duration" TEXT,
    "total_with_vat" DECIMAL(12,2) NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "payment_date" TIMESTAMP(3),
    "imported_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "electricity_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "via_verde_movements_tenant_id_obu_key" ON "via_verde_movements"("tenant_id", "obu");

-- CreateIndex
CREATE INDEX "via_verde_movements_tenant_id_license_plate_idx" ON "via_verde_movements"("tenant_id", "license_plate");

-- CreateIndex
CREATE INDEX "via_verde_movements_tenant_id_is_paid_idx" ON "via_verde_movements"("tenant_id", "is_paid");

-- CreateIndex
CREATE INDEX "via_verde_movements_tenant_id_entry_date_idx" ON "via_verde_movements"("tenant_id", "entry_date");

-- CreateIndex
CREATE INDEX "electricity_charges_tenant_id_charge_date_idx" ON "electricity_charges"("tenant_id", "charge_date");

-- CreateIndex
CREATE INDEX "electricity_charges_tenant_id_is_paid_idx" ON "electricity_charges"("tenant_id", "is_paid");

-- CreateIndex
CREATE INDEX "electricity_charges_tenant_id_card_number_idx" ON "electricity_charges"("tenant_id", "card_number");

-- CreateIndex
CREATE INDEX "electricity_charges_tenant_id_charge_external_id_idx" ON "electricity_charges"("tenant_id", "charge_external_id");

-- AddForeignKey
ALTER TABLE "via_verde_movements" ADD CONSTRAINT "via_verde_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "via_verde_movements" ADD CONSTRAINT "via_verde_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "via_verde_movements" ADD CONSTRAINT "via_verde_movements_user_vehicle_id_fkey" FOREIGN KEY ("user_vehicle_id") REFERENCES "user_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "via_verde_movements" ADD CONSTRAINT "via_verde_movements_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electricity_charges" ADD CONSTRAINT "electricity_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electricity_charges" ADD CONSTRAINT "electricity_charges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electricity_charges" ADD CONSTRAINT "electricity_charges_user_vehicle_id_fkey" FOREIGN KEY ("user_vehicle_id") REFERENCES "user_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electricity_charges" ADD CONSTRAINT "electricity_charges_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

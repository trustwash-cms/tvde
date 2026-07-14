-- CreateTable
CREATE TABLE "bolt_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "encrypted_client_secret" TEXT NOT NULL,
    "encrypted_access_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "bolt_company_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at_orders" TIMESTAMP(3),
    "last_sync_at_drivers" TIMESTAMP(3),
    "last_sync_at_vehicles" TIMESTAMP(3),
    "last_error" TEXT,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bolt_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bolt_orders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_reference" TEXT NOT NULL,
    "bolt_company_id" INTEGER,
    "driver_name" TEXT,
    "driver_uuid" TEXT,
    "driver_phone" TEXT,
    "order_status" TEXT,
    "vehicle_model" TEXT,
    "vehicle_license_plate" TEXT,
    "order_created_timestamp" TIMESTAMP(3),
    "ride_price" DECIMAL(12,2),
    "booking_fee" DECIMAL(12,2),
    "toll_fee" DECIMAL(12,2),
    "raw_json" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bolt_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bolt_order_stops" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "stop_type" TEXT NOT NULL,
    "lat" DECIMAL(10,6),
    "lng" DECIMAL(10,6),
    "real_lat" DECIMAL(10,6),
    "real_lng" DECIMAL(10,6),
    "stop_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bolt_order_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bolt_drivers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "driver_uuid" TEXT NOT NULL,
    "partner_uuid" TEXT,
    "bolt_company_id" INTEGER,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "portal_status" TEXT,
    "created_at_timestamp" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bolt_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bolt_vehicles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "bolt_company_id" INTEGER,
    "model" TEXT,
    "year" INTEGER,
    "reg_number" TEXT,
    "vin" TEXT,
    "uuid" TEXT,
    "state" TEXT,
    "portal_status" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bolt_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bolt_sync_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sync_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "records_synced" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,

    CONSTRAINT "bolt_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bolt_connections_workspace_id_key" ON "bolt_connections"("workspace_id");

-- CreateIndex
CREATE INDEX "bolt_connections_tenant_id_idx" ON "bolt_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "bolt_orders_workspace_id_order_created_timestamp_idx" ON "bolt_orders"("workspace_id", "order_created_timestamp");

-- CreateIndex
CREATE INDEX "bolt_orders_tenant_id_idx" ON "bolt_orders"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bolt_orders_workspace_id_order_reference_key" ON "bolt_orders"("workspace_id", "order_reference");

-- CreateIndex
CREATE INDEX "bolt_order_stops_order_id_idx" ON "bolt_order_stops"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "bolt_drivers_workspace_id_driver_uuid_key" ON "bolt_drivers"("workspace_id", "driver_uuid");

-- CreateIndex
CREATE INDEX "bolt_drivers_tenant_id_idx" ON "bolt_drivers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bolt_vehicles_workspace_id_vehicle_id_key" ON "bolt_vehicles"("workspace_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "bolt_vehicles_tenant_id_idx" ON "bolt_vehicles"("tenant_id");

-- CreateIndex
CREATE INDEX "bolt_sync_logs_workspace_id_started_at_idx" ON "bolt_sync_logs"("workspace_id", "started_at");

-- CreateIndex
CREATE INDEX "bolt_sync_logs_tenant_id_idx" ON "bolt_sync_logs"("tenant_id");

-- AddForeignKey
ALTER TABLE "bolt_connections" ADD CONSTRAINT "bolt_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_connections" ADD CONSTRAINT "bolt_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_orders" ADD CONSTRAINT "bolt_orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_orders" ADD CONSTRAINT "bolt_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_order_stops" ADD CONSTRAINT "bolt_order_stops_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "bolt_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_drivers" ADD CONSTRAINT "bolt_drivers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_drivers" ADD CONSTRAINT "bolt_drivers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_vehicles" ADD CONSTRAINT "bolt_vehicles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_vehicles" ADD CONSTRAINT "bolt_vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_sync_logs" ADD CONSTRAINT "bolt_sync_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolt_sync_logs" ADD CONSTRAINT "bolt_sync_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

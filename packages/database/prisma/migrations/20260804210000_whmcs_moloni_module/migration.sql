-- CreateTable
CREATE TABLE "whmcs_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "api_url" VARCHAR(512) NOT NULL,
    "api_identifier" VARCHAR(255) NOT NULL,
    "encrypted_api_secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "emit_on_paid" BOOLEAN NOT NULL DEFAULT true,
    "send_email_on_issue" BOOLEAN NOT NULL DEFAULT true,
    "document_type" VARCHAR(64) NOT NULL DEFAULT 'invoice_receipt',
    "document_set_id" INTEGER,
    "poll_lookback_days" INTEGER NOT NULL DEFAULT 30,
    "connected_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whmcs_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whmcs_invoice_maps" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "whmcs_invoice_id" INTEGER NOT NULL,
    "whmcs_invoice_num" VARCHAR(64),
    "whmcs_client_id" INTEGER,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "billing_invoice_id" UUID,
    "moloni_external_id" VARCHAR(64),
    "amount_total" DECIMAL(12,2),
    "currency" VARCHAR(8),
    "paid_at" TIMESTAMP(3),
    "last_error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whmcs_invoice_maps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whmcs_connections_workspace_id_key" ON "whmcs_connections"("workspace_id");
CREATE INDEX "whmcs_connections_tenant_id_idx" ON "whmcs_connections"("tenant_id");
CREATE UNIQUE INDEX "whmcs_invoice_maps_workspace_id_whmcs_invoice_id_key" ON "whmcs_invoice_maps"("workspace_id", "whmcs_invoice_id");
CREATE INDEX "whmcs_invoice_maps_tenant_id_status_idx" ON "whmcs_invoice_maps"("tenant_id", "status");
CREATE INDEX "whmcs_invoice_maps_workspace_id_status_idx" ON "whmcs_invoice_maps"("workspace_id", "status");

ALTER TABLE "whmcs_connections" ADD CONSTRAINT "whmcs_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whmcs_connections" ADD CONSTRAINT "whmcs_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whmcs_invoice_maps" ADD CONSTRAINT "whmcs_invoice_maps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whmcs_invoice_maps" ADD CONSTRAINT "whmcs_invoice_maps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whmcs_invoice_maps" ADD CONSTRAINT "whmcs_invoice_maps_billing_invoice_id_fkey" FOREIGN KEY ("billing_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

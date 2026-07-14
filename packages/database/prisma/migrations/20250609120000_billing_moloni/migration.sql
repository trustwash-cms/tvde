ALTER TABLE "clients" ADD COLUMN "external_customer_id" TEXT;
ALTER TABLE "clients" ADD COLUMN "billing_provider" TEXT;

ALTER TABLE "invoices" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "invoices" ADD COLUMN "external_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN "notes" TEXT;
ALTER TABLE "invoices" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "invoices" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "invoice_lines" ADD COLUMN "product_id" UUID;

CREATE TABLE "billing_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'moloni',
    "client_id" TEXT NOT NULL,
    "encrypted_client_secret" TEXT NOT NULL,
    "encrypted_access_token" TEXT,
    "encrypted_refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "company_id" INTEGER,
    "document_set_id" INTEGER,
    "redirect_uri" TEXT,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_connections_workspace_id_key" ON "billing_connections"("workspace_id");

ALTER TABLE "billing_connections" ADD CONSTRAINT "billing_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

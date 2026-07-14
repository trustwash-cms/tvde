-- Clientes loja eCommerce (conta pública) + ligação a encomendas

CREATE TABLE IF NOT EXISTS "ecommerce_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "nif" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_customers_workspace_id_email_key"
    ON "ecommerce_customers"("workspace_id", "email");
CREATE INDEX IF NOT EXISTS "ecommerce_customers_tenant_id_workspace_id_idx"
    ON "ecommerce_customers"("tenant_id", "workspace_id");

DO $$ BEGIN
    ALTER TABLE "ecommerce_customers" ADD CONSTRAINT "ecommerce_customers_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ecommerce_customers" ADD CONSTRAINT "ecommerce_customers_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "customer_id" UUID;

CREATE INDEX IF NOT EXISTS "ecommerce_orders_customer_id_idx"
    ON "ecommerce_orders"("customer_id");

DO $$ BEGIN
    ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_customer_id_fkey"
        FOREIGN KEY ("customer_id") REFERENCES "ecommerce_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

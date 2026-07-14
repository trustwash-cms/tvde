-- Encomendas eCommerce (checkout loja → Stripe)

CREATE TABLE IF NOT EXISTS "ecommerce_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "customer_phone" TEXT,
    "shipping_address" TEXT,
    "shipping_city" TEXT,
    "shipping_post_code" TEXT,
    "subtotal_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "stripe_payment_request_id" UUID,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ecommerce_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "product_slug" TEXT NOT NULL,
    "sku" TEXT,
    "unit_price_cents" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,

    CONSTRAINT "ecommerce_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_orders_workspace_id_reference_key"
    ON "ecommerce_orders"("workspace_id", "reference");
CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_orders_stripe_payment_request_id_key"
    ON "ecommerce_orders"("stripe_payment_request_id");
CREATE INDEX IF NOT EXISTS "ecommerce_orders_tenant_id_workspace_id_status_created_at_idx"
    ON "ecommerce_orders"("tenant_id", "workspace_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "ecommerce_order_lines_order_id_idx"
    ON "ecommerce_order_lines"("order_id");

DO $$ BEGIN
    ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stripe_payment_requests'
  ) THEN
    ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_stripe_payment_request_id_fkey"
        FOREIGN KEY ("stripe_payment_request_id") REFERENCES "stripe_payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ecommerce_order_lines" ADD CONSTRAINT "ecommerce_order_lines_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "ecommerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Método de entrega e recolha Correos Express
ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "delivery_method" TEXT NOT NULL DEFAULT 'home_delivery';
ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "correos_pickup_number" TEXT;
ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "correos_pickup_requested_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "ecommerce_orders_delivery_method_idx"
  ON "ecommerce_orders"("workspace_id", "delivery_method");

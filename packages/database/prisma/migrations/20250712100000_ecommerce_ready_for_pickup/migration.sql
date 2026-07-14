ALTER TABLE "ecommerce_orders" ADD COLUMN IF NOT EXISTS "ready_for_pickup_at" TIMESTAMPTZ;

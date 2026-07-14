ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "part_number" TEXT;
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "ean" TEXT;
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "warranty_months" INTEGER;

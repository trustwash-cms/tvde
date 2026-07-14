-- Peso e dimensões do produto (envio calculado por peso)
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "weight_grams" INTEGER;
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "length_cm" DECIMAL(8,2);
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "width_cm" DECIMAL(8,2);
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "height_cm" DECIMAL(8,2);

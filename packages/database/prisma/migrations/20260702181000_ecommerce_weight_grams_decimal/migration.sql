-- Peso em gramas com casas decimais (ex. 14,6 g)
ALTER TABLE "ecommerce_products" ALTER COLUMN "weight_grams" TYPE DECIMAL(8,2) USING weight_grams::decimal;

-- Corrigir pesos inflacionados x1000 da 1.ª importação (kg em vez de g)
UPDATE "ecommerce_products"
SET weight_grams = ROUND(weight_grams / 1000.0, 2)
WHERE weight_grams >= 1000
  AND weight_grams < 500000
  AND (weight_grams / 1000.0) <= 500
  AND weight_grams <> 1000;

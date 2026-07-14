-- Preço s/ IVA com 4 casas decimais para evitar drift de 1 cêntimo no PVP.
ALTER TABLE "carwash_catalog_items"
  ALTER COLUMN "price" TYPE DECIMAL(12, 4);

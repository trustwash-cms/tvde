ALTER TABLE ecommerce_products ADD COLUMN IF NOT EXISTS reseller_price DECIMAL(12, 2);
ALTER TABLE ecommerce_products ADD COLUMN IF NOT EXISTS reseller_discount_percent DECIMAL(5, 2);

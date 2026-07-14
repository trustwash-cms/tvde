-- Preço de revenda (ex. importado do Woo short_description) e perfil revendedor em clientes
ALTER TABLE ecommerce_products ADD COLUMN IF NOT EXISTS reseller_price_ex_vat DECIMAL(12, 4);
ALTER TABLE ecommerce_customers ADD COLUMN IF NOT EXISTS is_reseller BOOLEAN NOT NULL DEFAULT false;

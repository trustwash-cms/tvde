-- Zona do item de menu: main (header) ou strip (nav secundário — tema Gift)
ALTER TABLE "ecommerce_nav_items" ADD COLUMN IF NOT EXISTS "nav_zone" VARCHAR(32) NOT NULL DEFAULT 'main';

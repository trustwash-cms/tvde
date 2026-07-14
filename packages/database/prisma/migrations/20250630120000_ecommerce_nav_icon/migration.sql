-- Ícone / miniatura opcional nos itens do strip (tema Gift)
ALTER TABLE "ecommerce_nav_items" ADD COLUMN IF NOT EXISTS "icon_media_id" UUID;

-- Menu isolado por storefront (ARC, Gift, …)
ALTER TABLE "ecommerce_nav_items" ADD COLUMN IF NOT EXISTS "storefront_id" VARCHAR(32) NOT NULL DEFAULT 'arc';

CREATE INDEX IF NOT EXISTS "ecommerce_nav_items_workspace_id_storefront_id_sort_order_idx"
  ON "ecommerce_nav_items" ("workspace_id", "storefront_id", "sort_order");

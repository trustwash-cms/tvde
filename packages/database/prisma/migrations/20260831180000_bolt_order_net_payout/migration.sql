-- Bolt: líquidos da Fleet (net_earnings) para pagamentos ao motorista
ALTER TABLE "bolt_orders" ADD COLUMN IF NOT EXISTS "commission" DECIMAL(12,2);
ALTER TABLE "bolt_orders" ADD COLUMN IF NOT EXISTS "tip" DECIMAL(12,2);
ALTER TABLE "bolt_orders" ADD COLUMN IF NOT EXISTS "net_earnings" DECIMAL(12,2);
ALTER TABLE "bolt_orders" ADD COLUMN IF NOT EXISTS "payout_amount" DECIMAL(12,2);

-- Backfill a partir de raw_json.order_price
UPDATE "bolt_orders"
SET
  "commission" = NULLIF(raw_json->'order_price'->>'commission', '')::decimal,
  "tip" = NULLIF(raw_json->'order_price'->>'tip', '')::decimal,
  "net_earnings" = NULLIF(raw_json->'order_price'->>'net_earnings', '')::decimal
WHERE raw_json IS NOT NULL
  AND raw_json->'order_price' IS NOT NULL;

UPDATE "bolt_orders"
SET "payout_amount" = ROUND(
  COALESCE("net_earnings", 0) + COALESCE("tip", 0) + COALESCE("toll_fee", 0),
  2
)
WHERE "net_earnings" IS NOT NULL;

-- Sem net no JSON: fallback ride_price (comportamento antigo)
UPDATE "bolt_orders"
SET "payout_amount" = "ride_price"
WHERE "payout_amount" IS NULL AND "ride_price" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "bolt_orders_tenant_id_payout_amount_idx" ON "bolt_orders"("tenant_id", "payout_amount");

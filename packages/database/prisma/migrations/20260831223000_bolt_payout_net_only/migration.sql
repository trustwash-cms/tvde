-- Corrigir payout: líquidos Fleet = net_earnings (não net+tip+toll)
UPDATE "bolt_orders"
SET "payout_amount" = ROUND("net_earnings", 2)
WHERE "net_earnings" IS NOT NULL;

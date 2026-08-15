-- Allow external ids (WHMCS invoice/client numbers, Moloni category ids, bulk lists in after_json).
ALTER TABLE "audit_logs"
  ALTER COLUMN "entity_id" TYPE TEXT USING "entity_id"::text;

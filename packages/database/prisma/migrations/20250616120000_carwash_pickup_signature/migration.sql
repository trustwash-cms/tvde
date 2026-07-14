ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_token_hash" TEXT;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_token_expires_at" TIMESTAMPTZ;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_token_used_at" TIMESTAMPTZ;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_link_sent_at" TIMESTAMPTZ;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_signed_at" TIMESTAMPTZ;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_signed_by_name" TEXT;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_signature_key" TEXT;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_signature_mime" TEXT;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_signer_ip" TEXT;
ALTER TABLE "carwash_work_sheets" ADD COLUMN IF NOT EXISTS "pickup_sign_channel" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "carwash_work_sheets_pickup_token_hash_key"
  ON "carwash_work_sheets"("pickup_token_hash")
  WHERE "pickup_token_hash" IS NOT NULL;

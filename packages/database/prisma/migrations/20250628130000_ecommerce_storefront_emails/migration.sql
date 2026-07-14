-- eCommerce storefront emails: tokens, tracking, job flags

ALTER TABLE "ecommerce_customers"
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "ecommerce_password_reset_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecommerce_password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecommerce_password_reset_tokens_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "ecommerce_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_password_reset_tokens_token_hash_key"
  ON "ecommerce_password_reset_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "ecommerce_password_reset_tokens_customer_id_idx"
  ON "ecommerce_password_reset_tokens"("customer_id");

CREATE TABLE IF NOT EXISTS "ecommerce_email_verification_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecommerce_email_verification_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecommerce_email_verification_tokens_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "ecommerce_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_email_verification_tokens_token_hash_key"
  ON "ecommerce_email_verification_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "ecommerce_email_verification_tokens_customer_id_idx"
  ON "ecommerce_email_verification_tokens"("customer_id");

ALTER TABLE "ecommerce_orders"
  ADD COLUMN IF NOT EXISTS "shipping_carrier" TEXT,
  ADD COLUMN IF NOT EXISTS "tracking_number" TEXT,
  ADD COLUMN IF NOT EXISTS "tracking_url" TEXT,
  ADD COLUMN IF NOT EXISTS "review_email_sent_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "abandoned_cart_email_sent_at" TIMESTAMPTZ;

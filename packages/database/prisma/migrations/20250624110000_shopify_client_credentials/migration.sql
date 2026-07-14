-- Shopify: suporte Dev Dashboard (Client ID + Secret + token cache 24h)

ALTER TABLE "shopify_connections" ADD COLUMN IF NOT EXISTS "client_id" TEXT;
ALTER TABLE "shopify_connections" ADD COLUMN IF NOT EXISTS "encrypted_client_secret" TEXT;
ALTER TABLE "shopify_connections" ADD COLUMN IF NOT EXISTS "access_token_expires_at" TIMESTAMP(3);
ALTER TABLE "shopify_connections" ALTER COLUMN "encrypted_access_token" DROP NOT NULL;

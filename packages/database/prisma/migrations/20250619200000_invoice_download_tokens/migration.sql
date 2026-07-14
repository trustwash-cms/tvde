-- Link público de download de faturas (email sem anexo PDF, expira em 90 dias)

CREATE TABLE IF NOT EXISTS "invoice_download_tokens" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_download_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_download_tokens_token_hash_key" ON "invoice_download_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "invoice_download_tokens_invoice_id_idx" ON "invoice_download_tokens"("invoice_id");
CREATE INDEX IF NOT EXISTS "invoice_download_tokens_expires_at_idx" ON "invoice_download_tokens"("expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_download_tokens_invoice_id_fkey'
  ) THEN
    ALTER TABLE "invoice_download_tokens" ADD CONSTRAINT "invoice_download_tokens_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

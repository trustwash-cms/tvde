-- Limite de downloads no link público de faturas + branding/SMTP de email de facturação (por workspace)

ALTER TABLE "invoice_download_tokens"
  ADD COLUMN IF NOT EXISTS "download_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_downloaded_at" TIMESTAMP(3);

ALTER TABLE "billing_connections"
  ADD COLUMN IF NOT EXISTS "email_brand_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "email_footer_text" TEXT,
  ADD COLUMN IF NOT EXISTS "email_support_email" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "email_smtp_host" TEXT,
  ADD COLUMN IF NOT EXISTS "email_smtp_port" INTEGER,
  ADD COLUMN IF NOT EXISTS "email_smtp_username" TEXT,
  ADD COLUMN IF NOT EXISTS "email_smtp_encrypted_password" TEXT,
  ADD COLUMN IF NOT EXISTS "email_smtp_from_email" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "email_smtp_from_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "email_smtp_tls" BOOLEAN NOT NULL DEFAULT true;

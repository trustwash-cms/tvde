-- Optional BCC for Moloni/billing invoice emails (workspace SMTP settings)
ALTER TABLE "billing_connections"
  ADD COLUMN IF NOT EXISTS "email_bcc" VARCHAR(255);

-- AlterTable
ALTER TABLE "calendar_scheduled_invoices"
ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "email_error_message" TEXT;

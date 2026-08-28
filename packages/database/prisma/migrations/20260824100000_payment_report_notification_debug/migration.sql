-- Persist email/WhatsApp delivery status on weekly payment reports

ALTER TABLE "payment_reports" ADD COLUMN "email_sent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payment_reports" ADD COLUMN "whatsapp_sent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payment_reports" ADD COLUMN "notification_debug" JSONB;

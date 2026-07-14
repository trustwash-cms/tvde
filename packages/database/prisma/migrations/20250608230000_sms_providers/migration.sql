-- AlterTable
ALTER TABLE "sms_configs" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'twilio';
ALTER TABLE "sms_configs" ADD COLUMN "service_plan_id" TEXT;
ALTER TABLE "sms_configs" ADD COLUMN "api_base_url" TEXT;
ALTER TABLE "sms_configs" ALTER COLUMN "account_sid" DROP NOT NULL;

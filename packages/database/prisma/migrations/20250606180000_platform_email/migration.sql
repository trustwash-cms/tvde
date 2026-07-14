-- SMTP e templates ao nível plataforma (MASTER) — tenant_id opcional
ALTER TABLE "smtp_configs" ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "email_templates" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- Um template por key ao nível plataforma
CREATE UNIQUE INDEX "email_templates_platform_key_idx"
  ON "email_templates"("key")
  WHERE "tenant_id" IS NULL;

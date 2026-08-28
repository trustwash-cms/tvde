-- WhatsApp Business API (Meta Cloud) — módulo isolado por tenant

CREATE TABLE "whatsapp_business_configs" (
    "tenant_id" UUID NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "business_account_id" TEXT,
    "api_version" TEXT NOT NULL DEFAULT 'v18.0',
    "webhook_verify_token" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "test_mode" BOOLEAN NOT NULL DEFAULT false,
    "template_header_urls" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_business_configs_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "whatsapp_business_notification_events" (
    "tenant_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_template" TEXT,
    "whatsapp_language" TEXT NOT NULL DEFAULT 'pt',
    "config_data" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_business_notification_events_pkey" PRIMARY KEY ("tenant_id","event_key")
);

ALTER TABLE "whatsapp_business_configs" ADD CONSTRAINT "whatsapp_business_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_business_notification_events" ADD CONSTRAINT "whatsapp_business_notification_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

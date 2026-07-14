-- WhatsApp templates scoped per tenant (each siteId / superadmin manages own templates)

DROP TABLE IF EXISTS "whatsapp_templates";

CREATE TABLE "whatsapp_templates" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("tenant_id","key")
);

ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

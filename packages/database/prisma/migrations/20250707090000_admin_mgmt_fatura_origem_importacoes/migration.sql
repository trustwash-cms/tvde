-- Origem das faturas (portal AT, Moloni, manual) + histórico de importações

ALTER TABLE "admin_mgmt_faturas"
    ADD COLUMN IF NOT EXISTS "origem" TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE "admin_mgmt_faturas"
    ADD COLUMN IF NOT EXISTS "origem_externa_id" TEXT;

ALTER TABLE "admin_mgmt_faturas"
    ADD COLUMN IF NOT EXISTS "billing_invoice_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "admin_mgmt_faturas_workspace_billing_invoice_id_key"
    ON "admin_mgmt_faturas"("workspace_id", "billing_invoice_id")
    WHERE "billing_invoice_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "admin_mgmt_faturas_workspace_origem_externa_key"
    ON "admin_mgmt_faturas"("workspace_id", "origem_externa_id")
    WHERE "origem_externa_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "admin_mgmt_importacoes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "ficheiro_nome" TEXT,
    "resumo_json" JSONB NOT NULL DEFAULT '{}',
    "erros_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_mgmt_importacoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_mgmt_importacoes_workspace_id_created_at_idx"
    ON "admin_mgmt_importacoes"("workspace_id", "created_at" DESC);

DO $$ BEGIN
    ALTER TABLE "admin_mgmt_importacoes"
        ADD CONSTRAINT "admin_mgmt_importacoes_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "admin_mgmt_importacoes"
        ADD CONSTRAINT "admin_mgmt_importacoes_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lançamentos manuais na conta corrente do cliente (abatimentos à dívida)

CREATE TABLE IF NOT EXISTS "admin_mgmt_lancamentos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "descricao" TEXT,
    "data_lancamento" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_lancamentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_mgmt_lancamentos_tenant_id_workspace_id_idx"
    ON "admin_mgmt_lancamentos"("tenant_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "admin_mgmt_lancamentos_workspace_id_cliente_id_idx"
    ON "admin_mgmt_lancamentos"("workspace_id", "cliente_id");

DO $$ BEGIN
    ALTER TABLE "admin_mgmt_lancamentos"
        ADD CONSTRAINT "admin_mgmt_lancamentos_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "admin_mgmt_lancamentos"
        ADD CONSTRAINT "admin_mgmt_lancamentos_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "admin_mgmt_lancamentos"
        ADD CONSTRAINT "admin_mgmt_lancamentos_cliente_id_fkey"
        FOREIGN KEY ("cliente_id") REFERENCES "admin_mgmt_clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

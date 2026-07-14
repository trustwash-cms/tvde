-- Gestão Administrativa: clientes + faturas (fase 1)

CREATE TABLE "admin_mgmt_clientes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "nif" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "morada" TEXT,
    "cms_client_id" UUID,
    "billing_entity_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_clientes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_faturas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "tipo_documento" TEXT NOT NULL DEFAULT 'fatura',
    "numero" TEXT NOT NULL,
    "atcud" TEXT,
    "data_emissao" DATE NOT NULL,
    "data_vencimento" DATE,
    "descricao_resumo" TEXT,
    "valor_liquido" DECIMAL(12,2),
    "valor_iva" DECIMAL(12,2),
    "valor_total" DECIMAL(12,2) NOT NULL,
    "moeda" TEXT NOT NULL DEFAULT 'EUR',
    "estado_pagamento" TEXT NOT NULL DEFAULT 'pendente',
    "data_pagamento" DATE,
    "metodo_pagamento" TEXT,
    "anexos_json" JSONB NOT NULL DEFAULT '[]',
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_faturas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_mgmt_clientes_tenant_id_workspace_id_idx" ON "admin_mgmt_clientes"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_clientes_workspace_id_nif_idx" ON "admin_mgmt_clientes"("workspace_id", "nif");

CREATE INDEX "admin_mgmt_faturas_tenant_id_workspace_id_idx" ON "admin_mgmt_faturas"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_faturas_workspace_id_cliente_id_idx" ON "admin_mgmt_faturas"("workspace_id", "cliente_id");
CREATE INDEX "admin_mgmt_faturas_workspace_id_estado_pagamento_idx" ON "admin_mgmt_faturas"("workspace_id", "estado_pagamento");
CREATE INDEX "admin_mgmt_faturas_workspace_id_data_vencimento_idx" ON "admin_mgmt_faturas"("workspace_id", "data_vencimento");

ALTER TABLE "admin_mgmt_clientes" ADD CONSTRAINT "admin_mgmt_clientes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_clientes" ADD CONSTRAINT "admin_mgmt_clientes_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_clientes" ADD CONSTRAINT "admin_mgmt_clientes_cms_client_id_fkey"
    FOREIGN KEY ("cms_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_clientes" ADD CONSTRAINT "admin_mgmt_clientes_billing_entity_id_fkey"
    FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "admin_mgmt_faturas" ADD CONSTRAINT "admin_mgmt_faturas_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_faturas" ADD CONSTRAINT "admin_mgmt_faturas_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_faturas" ADD CONSTRAINT "admin_mgmt_faturas_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "admin_mgmt_clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

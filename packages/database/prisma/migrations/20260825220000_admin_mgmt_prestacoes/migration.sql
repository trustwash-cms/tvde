-- CreateTable
CREATE TABLE "admin_mgmt_prestacoes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "beneficiario_nome" TEXT NOT NULL,
    "beneficiario_nif" TEXT,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "valor_prestacao" DECIMAL(12,2) NOT NULL,
    "dia_vencimento" INTEGER,
    "data_inicio" DATE NOT NULL,
    "data_fim_prevista" DATE,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_prestacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_mgmt_prestacao_pagamentos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "prestacao_id" UUID NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "data_pagamento" DATE NOT NULL,
    "mes_referencia" DATE,
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_mgmt_prestacao_pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_mgmt_prestacoes_tenant_id_workspace_id_idx" ON "admin_mgmt_prestacoes"("tenant_id", "workspace_id");

-- CreateIndex
CREATE INDEX "admin_mgmt_prestacoes_workspace_id_status_idx" ON "admin_mgmt_prestacoes"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "admin_mgmt_prestacao_pagamentos_prestacao_id_data_pagamento_idx" ON "admin_mgmt_prestacao_pagamentos"("prestacao_id", "data_pagamento");

-- AddForeignKey
ALTER TABLE "admin_mgmt_prestacoes" ADD CONSTRAINT "admin_mgmt_prestacoes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_mgmt_prestacoes" ADD CONSTRAINT "admin_mgmt_prestacoes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_mgmt_prestacao_pagamentos" ADD CONSTRAINT "admin_mgmt_prestacao_pagamentos_prestacao_id_fkey" FOREIGN KEY ("prestacao_id") REFERENCES "admin_mgmt_prestacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_mgmt_prestacao_pagamentos" ADD CONSTRAINT "admin_mgmt_prestacao_pagamentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_mgmt_prestacao_pagamentos" ADD CONSTRAINT "admin_mgmt_prestacao_pagamentos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

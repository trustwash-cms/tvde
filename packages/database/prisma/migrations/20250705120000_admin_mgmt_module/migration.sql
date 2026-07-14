-- Gestão Administrativa module (admin_mgmt)

CREATE TABLE "admin_mgmt_seguros" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "seguradora" TEXT NOT NULL,
    "tipo_produto" TEXT NOT NULL,
    "opcao_cobertura" TEXT,
    "numero_apolice" TEXT,
    "objeto_tipo" TEXT NOT NULL DEFAULT 'outro',
    "objeto_ref_id" UUID,
    "objeto_descricao" TEXT,
    "entidade_cobradora" TEXT,
    "periodicidade_pagamento" TEXT NOT NULL DEFAULT 'mensal',
    "data_inicio_periodo" DATE,
    "data_fim_periodo" DATE NOT NULL,
    "premio_comercial" DECIMAL(12,2),
    "custos_fracionamento" DECIMAL(12,2),
    "custos_gestao_seguro" DECIMAL(12,2),
    "imposto_selo" DECIMAL(12,2),
    "outros_encargos_taxas" DECIMAL(12,2),
    "total_pago" DECIMAL(12,2),
    "numero_fatura_recibo" TEXT,
    "data_emissao" DATE,
    "assistencia_viagem" BOOLEAN NOT NULL DEFAULT false,
    "capital_rc" DECIMAL(14,2),
    "cobertura_roubo" BOOLEAN NOT NULL DEFAULT false,
    "status_pagamento" TEXT NOT NULL DEFAULT 'pendente',
    "attachment_storage_key" TEXT,
    "attachment_file_name" TEXT,
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_seguros_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_contratos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'outro',
    "contraparte_nome" TEXT NOT NULL,
    "contraparte_nif" TEXT,
    "objeto" TEXT,
    "valor" DECIMAL(12,2),
    "periodicidade" TEXT NOT NULL DEFAULT 'unico',
    "data_inicio" DATE NOT NULL,
    "data_fim" DATE,
    "renovacao_automatica" BOOLEAN NOT NULL DEFAULT false,
    "pre_aviso_denuncia_dias" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "attachment_storage_key" TEXT,
    "attachment_file_name" TEXT,
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_contratos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_despesas_pessoal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "colaborador_nome" TEXT NOT NULL,
    "colaborador_niss" TEXT,
    "mes_referencia" DATE NOT NULL,
    "vencimento_base" DECIMAL(12,2),
    "subsidio_alimentacao" DECIMAL(12,2),
    "subsidio_ferias" DECIMAL(12,2),
    "subsidio_natal" DECIMAL(12,2),
    "outros_abonos" DECIMAL(12,2),
    "retencao_irs" DECIMAL(12,2),
    "retencao_ss_trabalhador" DECIMAL(12,2),
    "ss_entidade_patronal" DECIMAL(12,2),
    "valor_liquido_pago" DECIMAL(12,2),
    "data_pagamento" DATE,
    "attachment_storage_key" TEXT,
    "attachment_file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_despesas_pessoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_seguranca_social" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "mes_referencia" DATE NOT NULL,
    "valor_trabalhadores" DECIMAL(12,2),
    "valor_entidade_patronal" DECIMAL(12,2),
    "valor_total_guia" DECIMAL(12,2),
    "data_limite_pagamento" DATE NOT NULL,
    "numero_guia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "attachment_storage_key" TEXT,
    "attachment_file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_seguranca_social_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_irs_empresa" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'retencao_trabalho_dependente',
    "periodo_referencia" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "data_limite_entrega" DATE NOT NULL,
    "numero_guia_referencia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "attachment_storage_key" TEXT,
    "attachment_file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_irs_empresa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_iva" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'trimestral',
    "periodo_referencia" TEXT NOT NULL,
    "iva_liquidado" DECIMAL(12,2),
    "iva_dedutivel" DECIMAL(12,2),
    "iva_apurado" DECIMAL(12,2),
    "data_limite_entrega_declaracao" DATE,
    "data_limite_pagamento" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "attachment_storage_key" TEXT,
    "attachment_file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_iva_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_recibos_verdes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "prestador_nome" TEXT NOT NULL,
    "prestador_nif" TEXT,
    "numero_recibo" TEXT,
    "data_emissao" DATE NOT NULL,
    "descricao_servico" TEXT,
    "valor_bruto" DECIMAL(12,2),
    "taxa_retencao_irs" DECIMAL(5,2),
    "valor_retencao_irs" DECIMAL(12,2),
    "isento_ss" BOOLEAN NOT NULL DEFAULT false,
    "valor_ss" DECIMAL(12,2),
    "valor_liquido" DECIMAL(12,2),
    "cliente_associado" TEXT,
    "attachment_storage_key" TEXT,
    "attachment_file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_recibos_verdes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mgmt_vencimentos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "origem_tipo" TEXT NOT NULL,
    "origem_id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "dias_antecedencia_alerta" INTEGER NOT NULL DEFAULT 15,
    "valor_associado" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "responsavel" TEXT,
    "resolvido_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mgmt_vencimentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_mgmt_seguros_tenant_id_workspace_id_idx" ON "admin_mgmt_seguros"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_seguros_workspace_id_data_fim_periodo_idx" ON "admin_mgmt_seguros"("workspace_id", "data_fim_periodo");
CREATE INDEX "admin_mgmt_contratos_tenant_id_workspace_id_idx" ON "admin_mgmt_contratos"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_contratos_workspace_id_data_fim_idx" ON "admin_mgmt_contratos"("workspace_id", "data_fim");
CREATE INDEX "admin_mgmt_despesas_pessoal_tenant_id_workspace_id_idx" ON "admin_mgmt_despesas_pessoal"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_despesas_pessoal_workspace_id_mes_referencia_idx" ON "admin_mgmt_despesas_pessoal"("workspace_id", "mes_referencia");
CREATE INDEX "admin_mgmt_seguranca_social_tenant_id_workspace_id_idx" ON "admin_mgmt_seguranca_social"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_seguranca_social_workspace_id_data_limite_pagamento_idx" ON "admin_mgmt_seguranca_social"("workspace_id", "data_limite_pagamento");
CREATE INDEX "admin_mgmt_irs_empresa_tenant_id_workspace_id_idx" ON "admin_mgmt_irs_empresa"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_irs_empresa_workspace_id_data_limite_entrega_idx" ON "admin_mgmt_irs_empresa"("workspace_id", "data_limite_entrega");
CREATE INDEX "admin_mgmt_iva_tenant_id_workspace_id_idx" ON "admin_mgmt_iva"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_iva_workspace_id_data_limite_pagamento_idx" ON "admin_mgmt_iva"("workspace_id", "data_limite_pagamento");
CREATE INDEX "admin_mgmt_recibos_verdes_tenant_id_workspace_id_idx" ON "admin_mgmt_recibos_verdes"("tenant_id", "workspace_id");
CREATE INDEX "admin_mgmt_recibos_verdes_workspace_id_data_emissao_idx" ON "admin_mgmt_recibos_verdes"("workspace_id", "data_emissao");
CREATE UNIQUE INDEX "admin_mgmt_vencimentos_workspace_id_origem_tipo_origem_id_key" ON "admin_mgmt_vencimentos"("workspace_id", "origem_tipo", "origem_id");
CREATE INDEX "admin_mgmt_vencimentos_tenant_id_workspace_id_data_vencimento_idx" ON "admin_mgmt_vencimentos"("tenant_id", "workspace_id", "data_vencimento");
CREATE INDEX "admin_mgmt_vencimentos_workspace_id_status_data_vencimento_idx" ON "admin_mgmt_vencimentos"("workspace_id", "status", "data_vencimento");

ALTER TABLE "admin_mgmt_seguros" ADD CONSTRAINT "admin_mgmt_seguros_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_seguros" ADD CONSTRAINT "admin_mgmt_seguros_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_contratos" ADD CONSTRAINT "admin_mgmt_contratos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_contratos" ADD CONSTRAINT "admin_mgmt_contratos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_despesas_pessoal" ADD CONSTRAINT "admin_mgmt_despesas_pessoal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_despesas_pessoal" ADD CONSTRAINT "admin_mgmt_despesas_pessoal_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_seguranca_social" ADD CONSTRAINT "admin_mgmt_seguranca_social_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_seguranca_social" ADD CONSTRAINT "admin_mgmt_seguranca_social_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_irs_empresa" ADD CONSTRAINT "admin_mgmt_irs_empresa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_irs_empresa" ADD CONSTRAINT "admin_mgmt_irs_empresa_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_iva" ADD CONSTRAINT "admin_mgmt_iva_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_iva" ADD CONSTRAINT "admin_mgmt_iva_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_recibos_verdes" ADD CONSTRAINT "admin_mgmt_recibos_verdes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_recibos_verdes" ADD CONSTRAINT "admin_mgmt_recibos_verdes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_vencimentos" ADD CONSTRAINT "admin_mgmt_vencimentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mgmt_vencimentos" ADD CONSTRAINT "admin_mgmt_vencimentos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "version", "description", "is_core")
VALUES (
  'admin_mgmt',
  'Gestão Administrativa',
  '1.0.0',
  'Seguros, contratos, pessoal, fiscal e alertas de vencimentos',
  false
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'admin_mgmt', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at", "config_json")
SELECT gen_random_uuid(), w."id", 'admin_mgmt', false, NULL, '{}'::jsonb
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

-- Seguros: matrícula (Automóvel) + múltiplas apólices (JSON)

ALTER TABLE "admin_mgmt_seguros"
  ADD COLUMN IF NOT EXISTS "matricula" TEXT,
  ADD COLUMN IF NOT EXISTS "apolices_json" JSONB NOT NULL DEFAULT '[]';

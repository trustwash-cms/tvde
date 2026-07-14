-- Alocação de lançamentos: liquidação de fatura + remanescente na conta corrente

ALTER TABLE "admin_mgmt_lancamentos"
    ADD COLUMN IF NOT EXISTS "valor_abatimento" DECIMAL(12,2);

ALTER TABLE "admin_mgmt_lancamentos"
    ADD COLUMN IF NOT EXISTS "fatura_liquidada_id" UUID;

ALTER TABLE "admin_mgmt_lancamentos"
    ADD COLUMN IF NOT EXISTS "valor_fatura_liquidada" DECIMAL(12,2);

UPDATE "admin_mgmt_lancamentos"
SET "valor_abatimento" = "valor"
WHERE "valor_abatimento" IS NULL;

ALTER TABLE "admin_mgmt_lancamentos"
    ALTER COLUMN "valor_abatimento" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "admin_mgmt_lancamentos_fatura_liquidada_id_idx"
    ON "admin_mgmt_lancamentos"("fatura_liquidada_id");

DO $$ BEGIN
    ALTER TABLE "admin_mgmt_lancamentos"
        ADD CONSTRAINT "admin_mgmt_lancamentos_fatura_liquidada_id_fkey"
        FOREIGN KEY ("fatura_liquidada_id") REFERENCES "admin_mgmt_faturas"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

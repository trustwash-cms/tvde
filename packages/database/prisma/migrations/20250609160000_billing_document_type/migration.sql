-- Tipos de documento Moloni por rascunho/fatura
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "document_type" VARCHAR(50) NOT NULL DEFAULT 'invoice';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "entity_type" VARCHAR(50) NOT NULL DEFAULT 'customer';

CREATE INDEX IF NOT EXISTS "invoices_workspace_document_type_idx" ON "invoices"("workspace_id", "document_type");

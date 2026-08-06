-- Ref.ª Artigo explícita para linhas manuais (sem slug a partir da descrição)
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "product_reference" TEXT;

-- Moloni-specific invoice fields and line product/tax references
ALTER TABLE "invoices" ADD COLUMN "metadata_json" JSONB;

ALTER TABLE "invoice_lines" ADD COLUMN "external_product_id" TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "external_tax_id" TEXT;

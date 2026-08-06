-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "summary" VARCHAR(250);

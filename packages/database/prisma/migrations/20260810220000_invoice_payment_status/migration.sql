-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE "invoices" ADD COLUMN "paid_at" TIMESTAMP(3);

-- Backfill: fatura-recibo / invoice_receipt already settled on issue
UPDATE "invoices"
SET
  "payment_status" = 'pago',
  "paid_at" = COALESCE("issued_at", "created_at")
WHERE
  "status" = 'issued'
  AND (
    LOWER("document_type") = 'invoice_receipt'
    OR LOWER("document_type") LIKE '%receipt%'
    OR (
      LOWER("document_type") LIKE '%fatura%'
      AND LOWER("document_type") LIKE '%recibo%'
    )
  );

-- CreateIndex
CREATE INDEX "invoices_workspace_id_payment_status_idx" ON "invoices"("workspace_id", "payment_status");
CREATE INDEX "invoices_workspace_id_due_date_idx" ON "invoices"("workspace_id", "due_date");

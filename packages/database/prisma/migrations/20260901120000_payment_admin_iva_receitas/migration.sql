-- IVA 6% sobre receitas — registo interno superadmin (email fiscal, não visível ao motorista)
ALTER TABLE "payment_reports"
  ADD COLUMN "admin_iva_receitas_6" DECIMAL(12, 2),
  ADD COLUMN "admin_iva_receitas_sent_at" TIMESTAMP(3),
  ADD COLUMN "admin_iva_receitas_sent_to" VARCHAR(255);

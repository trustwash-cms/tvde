ALTER TABLE "carwash_daily_cash_sheets"
  ADD COLUMN IF NOT EXISTS "expense_lines" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "carwash_daily_cash_sheets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "business_date" DATE NOT NULL,
  "expenses" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "snapshot" JSONB NOT NULL,
  "closed_at" TIMESTAMPTZ NOT NULL,
  "closed_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "carwash_daily_cash_sheets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "carwash_daily_cash_sheets_workspace_id_business_date_key"
  ON "carwash_daily_cash_sheets"("workspace_id", "business_date");

CREATE INDEX IF NOT EXISTS "carwash_daily_cash_sheets_tenant_id_workspace_id_idx"
  ON "carwash_daily_cash_sheets"("tenant_id", "workspace_id");

DO $$ BEGIN
  ALTER TABLE "carwash_daily_cash_sheets"
    ADD CONSTRAINT "carwash_daily_cash_sheets_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "carwash_daily_cash_sheets"
    ADD CONSTRAINT "carwash_daily_cash_sheets_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "carwash_daily_cash_sheets"
    ADD CONSTRAINT "carwash_daily_cash_sheets_closed_by_id_fkey"
    FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

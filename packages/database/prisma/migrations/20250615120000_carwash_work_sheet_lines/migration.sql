-- Folha Obra: linhas de produtos/serviços + totais e datas de workflow

ALTER TABLE "carwash_work_sheets"
  ADD COLUMN "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "opened_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3);

CREATE TABLE "carwash_work_sheet_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "work_sheet_id" UUID NOT NULL,
    "catalog_item_id" UUID,
    "item_type" TEXT NOT NULL,
    "reference" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "tax_id" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carwash_work_sheet_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "carwash_work_sheet_lines_work_sheet_id_sort_order_idx"
  ON "carwash_work_sheet_lines"("work_sheet_id", "sort_order");

ALTER TABLE "carwash_work_sheet_lines"
  ADD CONSTRAINT "carwash_work_sheet_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carwash_work_sheet_lines"
  ADD CONSTRAINT "carwash_work_sheet_lines_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carwash_work_sheet_lines"
  ADD CONSTRAINT "carwash_work_sheet_lines_work_sheet_id_fkey"
  FOREIGN KEY ("work_sheet_id") REFERENCES "carwash_work_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carwash_work_sheet_lines"
  ADD CONSTRAINT "carwash_work_sheet_lines_catalog_item_id_fkey"
  FOREIGN KEY ("catalog_item_id") REFERENCES "carwash_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

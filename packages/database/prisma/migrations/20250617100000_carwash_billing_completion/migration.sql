-- CarWash: billing link, line invoicing, completion email
ALTER TABLE "carwash_entities" ADD COLUMN "billing_entity_id" UUID;
ALTER TABLE "carwash_catalog_items" ADD COLUMN "moloni_product_id" INTEGER;
ALTER TABLE "carwash_work_sheet_lines" ADD COLUMN "invoiced_qty" DECIMAL(10,3) NOT NULL DEFAULT 0;
ALTER TABLE "carwash_work_sheets" ADD COLUMN "completion_email_sent_at" TIMESTAMP(3);

CREATE INDEX "carwash_entities_billing_entity_id_idx" ON "carwash_entities"("billing_entity_id");

ALTER TABLE "carwash_entities" ADD CONSTRAINT "carwash_entities_billing_entity_id_fkey"
  FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

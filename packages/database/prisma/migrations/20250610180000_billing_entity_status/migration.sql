ALTER TABLE "billing_entities" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "billing_entities" ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "billing_entities_workspace_id_status_idx" ON "billing_entities"("workspace_id", "status");

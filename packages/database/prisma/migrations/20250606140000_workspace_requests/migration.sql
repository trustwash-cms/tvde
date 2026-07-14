-- CreateEnum
CREATE TYPE "WorkspaceRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "workspace_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "status" "WorkspaceRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "workspace_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_requests_tenant_id_status_idx" ON "workspace_requests"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "workspace_requests" ADD CONSTRAINT "workspace_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_requests" ADD CONSTRAINT "workspace_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_requests" ADD CONSTRAINT "workspace_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_requests" ADD CONSTRAINT "workspace_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Default max_workspaces = 1 for existing tenants (merge into limits_json)
UPDATE "tenants"
SET "limits_json" = "limits_json" || '{"max_workspaces": 1}'::jsonb
WHERE NOT ("limits_json" ? 'max_workspaces');

-- Align max_workspaces with actual count where tenant has more than 1 workspace already
UPDATE "tenants" t
SET "limits_json" = jsonb_set(
  t."limits_json",
  '{max_workspaces}',
  to_jsonb(GREATEST(
    COALESCE((t."limits_json"->>'max_workspaces')::int, 1),
    (SELECT COUNT(*)::int FROM "workspaces" w WHERE w."tenant_id" = t."id")
  ))
);

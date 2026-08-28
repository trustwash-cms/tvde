-- Virtualization PVE servers

CREATE TABLE "virtualization_pve_servers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "base_url" VARCHAR(500) NOT NULL,
    "api_token_id" VARCHAR(200),
    "encrypted_api_token" TEXT NOT NULL,
    "verify_ssl" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_pve_servers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "virtualization_pve_servers_tenant_id_workspace_id_idx" ON "virtualization_pve_servers"("tenant_id", "workspace_id");
CREATE INDEX "virtualization_pve_servers_workspace_id_sort_order_idx" ON "virtualization_pve_servers"("workspace_id", "sort_order");

ALTER TABLE "virtualization_pve_servers" ADD CONSTRAINT "virtualization_pve_servers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_pve_servers" ADD CONSTRAINT "virtualization_pve_servers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

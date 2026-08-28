-- ZeroTier: email on accounts + SSH join targets

ALTER TABLE "virtualization_zerotier_accounts"
ADD COLUMN "email" VARCHAR(255);

CREATE TABLE "virtualization_zerotier_join_targets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "network_row_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "ssh_host" VARCHAR(255) NOT NULL,
    "ssh_port" INTEGER NOT NULL DEFAULT 22,
    "ssh_username" VARCHAR(120) NOT NULL,
    "encrypted_ssh_password" TEXT NOT NULL,
    "target_kind" VARCHAR(20) NOT NULL DEFAULT 'custom',
    "pbs_server_id" UUID,
    "pve_server_id" UUID,
    "node_id" VARCHAR(20),
    "join_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "last_error" TEXT,
    "provision_log" TEXT,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_zerotier_join_targets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "virtualization_zerotier_join_targets_workspace_id_idx" ON "virtualization_zerotier_join_targets"("workspace_id");
CREATE INDEX "virtualization_zerotier_join_targets_network_row_id_idx" ON "virtualization_zerotier_join_targets"("network_row_id");

ALTER TABLE "virtualization_zerotier_join_targets" ADD CONSTRAINT "virtualization_zerotier_join_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_join_targets" ADD CONSTRAINT "virtualization_zerotier_join_targets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_join_targets" ADD CONSTRAINT "virtualization_zerotier_join_targets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "virtualization_zerotier_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_join_targets" ADD CONSTRAINT "virtualization_zerotier_join_targets_network_row_id_fkey" FOREIGN KEY ("network_row_id") REFERENCES "virtualization_zerotier_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_join_targets" ADD CONSTRAINT "virtualization_zerotier_join_targets_pbs_server_id_fkey" FOREIGN KEY ("pbs_server_id") REFERENCES "virtualization_pbs_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_join_targets" ADD CONSTRAINT "virtualization_zerotier_join_targets_pve_server_id_fkey" FOREIGN KEY ("pve_server_id") REFERENCES "virtualization_pve_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

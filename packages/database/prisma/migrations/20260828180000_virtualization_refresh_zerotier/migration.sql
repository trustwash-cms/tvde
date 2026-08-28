-- Dashboard refresh interval + ZeroTier accounts/networks

ALTER TABLE "virtualization_settings"
ADD COLUMN "dashboard_refresh_seconds" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "virtualization_zerotier_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "encrypted_api_token" TEXT NOT NULL,
    "api_mode" VARCHAR(20) NOT NULL DEFAULT 'legacy',
    "org_id" VARCHAR(120),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_zerotier_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "virtualization_zerotier_networks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "network_id" VARCHAR(16) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "member_limit" INTEGER NOT NULL DEFAULT 10,
    "last_member_count" INTEGER,
    "last_authorized_count" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtualization_zerotier_networks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "virtualization_zerotier_accounts_tenant_id_workspace_id_idx" ON "virtualization_zerotier_accounts"("tenant_id", "workspace_id");
CREATE INDEX "virtualization_zerotier_networks_account_id_idx" ON "virtualization_zerotier_networks"("account_id");
CREATE UNIQUE INDEX "virtualization_zerotier_networks_account_id_network_id_key" ON "virtualization_zerotier_networks"("account_id", "network_id");

ALTER TABLE "virtualization_zerotier_accounts" ADD CONSTRAINT "virtualization_zerotier_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_accounts" ADD CONSTRAINT "virtualization_zerotier_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_networks" ADD CONSTRAINT "virtualization_zerotier_networks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_networks" ADD CONSTRAINT "virtualization_zerotier_networks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtualization_zerotier_networks" ADD CONSTRAINT "virtualization_zerotier_networks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "virtualization_zerotier_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

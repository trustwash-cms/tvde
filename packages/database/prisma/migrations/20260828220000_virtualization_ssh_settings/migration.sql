-- Workspace-level SSH defaults for virtualization provisioning

ALTER TABLE "virtualization_settings"
ADD COLUMN "ssh_default_port" INTEGER NOT NULL DEFAULT 22,
ADD COLUMN "ssh_default_username" VARCHAR(120) NOT NULL DEFAULT 'root',
ADD COLUMN "ssh_auth_mode" VARCHAR(20) NOT NULL DEFAULT 'password',
ADD COLUMN "encrypted_ssh_password" TEXT,
ADD COLUMN "encrypted_ssh_private_key" TEXT,
ADD COLUMN "encrypted_ssh_passphrase" TEXT;

ALTER TABLE "virtualization_zerotier_join_targets"
ADD COLUMN "use_workspace_ssh" BOOLEAN NOT NULL DEFAULT true;

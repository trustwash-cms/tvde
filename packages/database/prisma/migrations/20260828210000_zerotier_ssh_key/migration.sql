-- SSH key auth for ZeroTier join targets

ALTER TABLE "virtualization_zerotier_join_targets"
ADD COLUMN "ssh_auth_mode" VARCHAR(20) NOT NULL DEFAULT 'password',
ADD COLUMN "encrypted_ssh_private_key" TEXT,
ADD COLUMN "encrypted_ssh_passphrase" TEXT;

ALTER TABLE "virtualization_zerotier_join_targets"
ALTER COLUMN "encrypted_ssh_password" DROP NOT NULL;

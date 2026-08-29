-- AlterTable
ALTER TABLE "virtualization_pve_servers" ADD COLUMN IF NOT EXISTS "guest_manual_ips" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_storage_key" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_mime_type" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_updated_at" TIMESTAMP(3);

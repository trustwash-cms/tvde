ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "temp_password_expires_at" TIMESTAMP(3);

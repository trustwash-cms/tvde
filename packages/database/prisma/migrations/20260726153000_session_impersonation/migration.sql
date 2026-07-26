-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "impersonator_id" UUID;
ALTER TABLE "sessions" ADD COLUMN "original_master_session_id" UUID;

-- CreateIndex
CREATE INDEX "sessions_impersonator_id_idx" ON "sessions"("impersonator_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonator_id_fkey" FOREIGN KEY ("impersonator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

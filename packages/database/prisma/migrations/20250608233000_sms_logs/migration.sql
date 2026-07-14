CREATE TABLE "sms_logs" (
    "id" UUID NOT NULL,
    "to_phone" TEXT NOT NULL,
    "body_preview" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL,
    "external_id" TEXT,
    "error_message" TEXT,
    "mocked" BOOLEAN NOT NULL DEFAULT false,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_logs_created_at_idx" ON "sms_logs"("created_at" DESC);

ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

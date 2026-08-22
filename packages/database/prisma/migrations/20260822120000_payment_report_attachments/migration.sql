-- Comprovativos de pagamento (payment_report_attachments)

CREATE TABLE "payment_report_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_report_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_report_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_report_attachments_payment_report_id_idx" ON "payment_report_attachments"("payment_report_id");
CREATE INDEX "payment_report_attachments_tenant_id_idx" ON "payment_report_attachments"("tenant_id");
CREATE INDEX "payment_report_attachments_created_at_idx" ON "payment_report_attachments"("created_at");

ALTER TABLE "payment_report_attachments" ADD CONSTRAINT "payment_report_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_report_attachments" ADD CONSTRAINT "payment_report_attachments_payment_report_id_fkey" FOREIGN KEY ("payment_report_id") REFERENCES "payment_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_report_attachments" ADD CONSTRAINT "payment_report_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

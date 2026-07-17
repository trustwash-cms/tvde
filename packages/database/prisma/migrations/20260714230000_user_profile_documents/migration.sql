-- CreateEnum
CREATE TYPE "UserDocumentType" AS ENUM ('comprovativo_morada', 'cc_autorizacao_residencia', 'licenca_tvde', 'carta_conducao', 'contrato_motorista');

-- CreateEnum
CREATE TYPE "UserDocumentVisibility" AS ENUM ('private', 'public');

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "nif" TEXT,
    "cc_autorizacao_residencia" TEXT,
    "numero_operador_tvde" TEXT,
    "distrito" TEXT,
    "concelho" TEXT,
    "localidade" TEXT,
    "arruamento" TEXT,
    "numero_porta" TEXT,
    "codigo_postal" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_type" "UserDocumentType" NOT NULL,
    "visibility" "UserDocumentVisibility" NOT NULL DEFAULT 'private',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_documents_user_id_idx" ON "user_documents"("user_id");

-- CreateIndex
CREATE INDEX "user_documents_tenant_id_idx" ON "user_documents"("tenant_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

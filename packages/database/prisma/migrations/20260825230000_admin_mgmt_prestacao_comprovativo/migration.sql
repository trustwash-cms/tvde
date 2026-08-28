-- Comprovativo de pagamento (Prestações)
ALTER TABLE "admin_mgmt_prestacao_pagamentos"
  ADD COLUMN "comprovativo_storage_key" TEXT,
  ADD COLUMN "comprovativo_file_name" VARCHAR(255),
  ADD COLUMN "comprovativo_mime_type" VARCHAR(100),
  ADD COLUMN "comprovativo_size_bytes" INTEGER;

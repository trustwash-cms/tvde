ALTER TABLE "admin_mgmt_faturas"
ADD COLUMN IF NOT EXISTS "notificar_cliente" BOOLEAN NOT NULL DEFAULT false;

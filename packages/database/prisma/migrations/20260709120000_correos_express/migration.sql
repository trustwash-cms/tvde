-- Correos Express — configuração por workspace + campos envio encomendas

CREATE TABLE IF NOT EXISTS "correos_express_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'test',
  "api_username" TEXT NOT NULL,
  "encrypted_api_password" TEXT NOT NULL,
  "solicitante" TEXT NOT NULL,
  "cod_rte" TEXT NOT NULL,
  "codigo_cliente" TEXT NOT NULL,
  "product_code" TEXT NOT NULL DEFAULT '63',
  "portes" TEXT NOT NULL DEFAULT 'P',
  "label_type" TEXT NOT NULL DEFAULT '1',
  "sender_name" TEXT NOT NULL,
  "sender_address" TEXT NOT NULL,
  "sender_city" TEXT NOT NULL,
  "sender_country_iso" TEXT NOT NULL DEFAULT 'PT',
  "sender_post_code" TEXT NOT NULL,
  "sender_phone" TEXT,
  "sender_email" TEXT,
  "sender_vat" TEXT,
  "connected_at" TIMESTAMP(3),
  "last_checked_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "correos_express_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "correos_express_connections_workspace_id_key"
  ON "correos_express_connections"("workspace_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'correos_express_connections_workspace_id_fkey'
  ) THEN
    ALTER TABLE "correos_express_connections"
      ADD CONSTRAINT "correos_express_connections_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ecommerce_orders"
  ADD COLUMN IF NOT EXISTS "correos_shipment_number" TEXT,
  ADD COLUMN IF NOT EXISTS "correos_label_created_at" TIMESTAMP(3);

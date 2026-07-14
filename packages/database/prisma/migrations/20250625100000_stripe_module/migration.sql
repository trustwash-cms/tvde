-- Módulo Stripe: ligação directa por workspace + pedidos de pagamento (Payment Links)

CREATE TABLE "stripe_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "publishable_key" TEXT NOT NULL,
    "encrypted_secret_key" TEXT NOT NULL,
    "encrypted_webhook_secret" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "connected_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stripe_payment_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "stripe_connection_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "description" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "stripe_payment_link_id" TEXT NOT NULL,
    "payment_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "link_sent_at" TIMESTAMP(3),
    "metadata_json" JSONB,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_payment_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_connections_workspace_id_key" ON "stripe_connections"("workspace_id");
CREATE INDEX "stripe_payment_requests_tenant_id_workspace_id_status_created_at_idx" ON "stripe_payment_requests"("tenant_id", "workspace_id", "status", "created_at");
CREATE INDEX "stripe_payment_requests_stripe_payment_link_id_idx" ON "stripe_payment_requests"("stripe_payment_link_id");

ALTER TABLE "stripe_connections" ADD CONSTRAINT "stripe_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stripe_payment_requests" ADD CONSTRAINT "stripe_payment_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stripe_payment_requests" ADD CONSTRAINT "stripe_payment_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stripe_payment_requests" ADD CONSTRAINT "stripe_payment_requests_stripe_connection_id_fkey" FOREIGN KEY ("stripe_connection_id") REFERENCES "stripe_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES (
  'stripe',
  'Stripe',
  'Links de pagamento — cartão, Klarna, MB Way (conta Stripe por workspace)',
  false,
  '1.0.0'
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'stripe', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", 'stripe', false, NULL
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

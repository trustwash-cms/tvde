-- CreateTable
CREATE TABLE "tenant_modules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "allowed_at" TIMESTAMP(3),

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_modules_tenant_id_idx" ON "tenant_modules"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_tenant_id_module_key_key" ON "tenant_modules"("tenant_id", "module_key");

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_module_key_fkey" FOREIGN KEY ("module_key") REFERENCES "module_registry"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: allow all business modules for existing tenants
INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t.id, m.key, true, NOW()
FROM "tenants" t
CROSS JOIN "module_registry" m
WHERE m.is_core = false
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

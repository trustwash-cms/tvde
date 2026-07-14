-- CarWash module

CREATE TABLE "carwash_entities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vat" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address_json" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carwash_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "carwash_catalog_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "item_type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reference" TEXT NOT NULL,
    "ean" TEXT,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "notes" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "tax_id" INTEGER NOT NULL DEFAULT 1,
    "unit_id" INTEGER NOT NULL DEFAULT 1,
    "pos_favorite" BOOLEAN NOT NULL DEFAULT false,
    "has_stock" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carwash_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "carwash_vehicles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "license_plate" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "images_json" JSONB NOT NULL DEFAULT '[]',
    "customer_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carwash_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "carwash_work_sheets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "reference" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Nova folha de obra',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "customer_id" UUID,
    "vehicle_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carwash_work_sheets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "carwash_entities_tenant_id_workspace_id_entity_type_idx" ON "carwash_entities"("tenant_id", "workspace_id", "entity_type");
CREATE INDEX "carwash_entities_workspace_id_status_idx" ON "carwash_entities"("workspace_id", "status");
CREATE UNIQUE INDEX "carwash_catalog_items_workspace_id_item_type_reference_key" ON "carwash_catalog_items"("workspace_id", "item_type", "reference");
CREATE INDEX "carwash_catalog_items_tenant_id_workspace_id_item_type_idx" ON "carwash_catalog_items"("tenant_id", "workspace_id", "item_type");
CREATE UNIQUE INDEX "carwash_vehicles_workspace_id_license_plate_key" ON "carwash_vehicles"("workspace_id", "license_plate");
CREATE INDEX "carwash_vehicles_tenant_id_workspace_id_idx" ON "carwash_vehicles"("tenant_id", "workspace_id");
CREATE INDEX "carwash_work_sheets_tenant_id_workspace_id_status_idx" ON "carwash_work_sheets"("tenant_id", "workspace_id", "status");

ALTER TABLE "carwash_entities" ADD CONSTRAINT "carwash_entities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_entities" ADD CONSTRAINT "carwash_entities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_catalog_items" ADD CONSTRAINT "carwash_catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_catalog_items" ADD CONSTRAINT "carwash_catalog_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_vehicles" ADD CONSTRAINT "carwash_vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_vehicles" ADD CONSTRAINT "carwash_vehicles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_vehicles" ADD CONSTRAINT "carwash_vehicles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "carwash_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "carwash_work_sheets" ADD CONSTRAINT "carwash_work_sheets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_work_sheets" ADD CONSTRAINT "carwash_work_sheets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carwash_work_sheets" ADD CONSTRAINT "carwash_work_sheets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "carwash_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "carwash_work_sheets" ADD CONSTRAINT "carwash_work_sheets_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "carwash_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES ('carwash', 'CarWash', 'Gestão de lavagem automóvel — clientes, produtos, serviços, veículos', false, '1.0.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", 'carwash', false, NULL
FROM "tenants" t
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", 'carwash', false, NULL
FROM "workspaces" w
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

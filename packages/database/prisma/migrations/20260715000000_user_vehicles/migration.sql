-- CreateEnum
CREATE TYPE "VehicleCommissionType" AS ENUM ('fixa', 'percentagem', 'slot');

-- CreateTable
CREATE TABLE "user_vehicles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "matricula" TEXT NOT NULL,
    "matricula_foreign" BOOLEAN NOT NULL DEFAULT false,
    "matricula_country" TEXT NOT NULL DEFAULT 'PT',
    "data_inicio" DATE NOT NULL,
    "data_fim" DATE,
    "uuid_uber" TEXT,
    "uuid_bolt" TEXT,
    "num_cartao_prio" TEXT,
    "nome_completo" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "ano" INTEGER,
    "aluguel_viatura" DECIMAL(10,2),
    "comissao_tipo" "VehicleCommissionType",
    "comissao_valor" DECIMAL(10,2),
    "comissao_iva_6" BOOLEAN NOT NULL DEFAULT false,
    "slot_incluir_via_verde" BOOLEAN NOT NULL DEFAULT false,
    "slot_incluir_eletricidade_combustivel" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_vehicles_user_id_idx" ON "user_vehicles"("user_id");

-- CreateIndex
CREATE INDEX "user_vehicles_tenant_id_idx" ON "user_vehicles"("tenant_id");

-- CreateIndex
CREATE INDEX "user_vehicles_tenant_id_matricula_idx" ON "user_vehicles"("tenant_id", "matricula");

-- AddForeignKey
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

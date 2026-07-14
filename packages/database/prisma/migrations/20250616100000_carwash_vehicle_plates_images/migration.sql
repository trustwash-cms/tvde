-- Matrícula nacional/estrangeira + país; unicidade por workspace + país + matrícula
ALTER TABLE "carwash_vehicles" ADD COLUMN IF NOT EXISTS "license_foreign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "carwash_vehicles" ADD COLUMN IF NOT EXISTS "license_country" TEXT NOT NULL DEFAULT 'PT';

DROP INDEX IF EXISTS "carwash_vehicles_workspace_id_license_plate_key";
CREATE UNIQUE INDEX IF NOT EXISTS "carwash_vehicles_workspace_id_license_country_license_plate_key"
  ON "carwash_vehicles"("workspace_id", "license_country", "license_plate");

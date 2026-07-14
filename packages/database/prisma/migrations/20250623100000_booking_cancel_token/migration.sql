-- Token público único por marcação (link de cancelamento isolado)

ALTER TABLE "bookings" ADD COLUMN "cancel_token" UUID;

UPDATE "bookings" SET "cancel_token" = gen_random_uuid() WHERE "cancel_token" IS NULL;

ALTER TABLE "bookings" ALTER COLUMN "cancel_token" SET NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "cancel_token" SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "bookings_cancel_token_key" ON "bookings"("cancel_token");

-- Username e nome completo nos utilizadores
ALTER TABLE "users" ADD COLUMN "username" TEXT;
ALTER TABLE "users" ADD COLUMN "full_name" TEXT;

-- Backfill username a partir do email (só letras e pontos)
UPDATE "users"
SET "username" = LOWER(REGEXP_REPLACE(SPLIT_PART("email", '@', 1), '[^a-zA-Z.]', '', 'g'))
WHERE "username" IS NULL;

UPDATE "users"
SET "username" = 'user_' || SUBSTRING(REPLACE("id"::text, '-', ''), 1, 8)
WHERE "username" IS NULL
   OR "username" = ''
   OR "username" !~ '^[a-zA-Z]+(\.[a-zA-Z]+)*$';

-- Resolver duplicados
WITH "dupes" AS (
  SELECT "id", "username", ROW_NUMBER() OVER (PARTITION BY "username" ORDER BY "created_at") AS "rn"
  FROM "users"
)
UPDATE "users" AS "u"
SET "username" = "u"."username" || "dupes"."rn"::text
FROM "dupes"
WHERE "u"."id" = "dupes"."id" AND "dupes"."rn" > 1;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

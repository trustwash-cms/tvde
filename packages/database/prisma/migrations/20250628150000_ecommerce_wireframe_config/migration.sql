-- Configuração JSON por wireframe (hero, círculos, secções…)
ALTER TABLE "ecommerce_settings"
ADD COLUMN IF NOT EXISTS "home_wireframe_config" JSONB;

-- Wireframe da home page (template de layout)
ALTER TABLE "ecommerce_settings"
ADD COLUMN IF NOT EXISTS "home_wireframe" TEXT NOT NULL DEFAULT 'default';

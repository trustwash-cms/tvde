-- Faixa superior da loja (utility bar) — texto e activação por workspace
ALTER TABLE ecommerce_settings
  ADD COLUMN IF NOT EXISTS utility_bar_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE ecommerce_settings
  ADD COLUMN IF NOT EXISTS utility_bar_text TEXT;

-- Store PBS API token ID (public) for display on edit — secret stays encrypted

ALTER TABLE "virtualization_pbs_servers"
ADD COLUMN IF NOT EXISTS "api_token_id" VARCHAR(200);

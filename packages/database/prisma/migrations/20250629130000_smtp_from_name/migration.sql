-- Nome visível do remetente (From display name) por configuração SMTP
ALTER TABLE smtp_configs ADD COLUMN IF NOT EXISTS from_name VARCHAR(255);

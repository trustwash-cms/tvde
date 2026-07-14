-- Módulos opcionais SMS e WhatsApp (autorização MASTER por tenant)

INSERT INTO "module_registry" ("key", "name", "description", "is_core", "version")
VALUES
  ('sms', 'SMS', 'Envio de SMS (2FA, notificações)', false, '1.0.0'),
  ('whatsapp', 'WhatsApp', 'Mensagens WhatsApp (2FA, templates)', false, '1.0.0')
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "tenant_modules" ("id", "tenant_id", "module_key", "allowed", "allowed_at")
SELECT gen_random_uuid(), t."id", m."key", true, NOW()
FROM "tenants" t
CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS m("key")
ON CONFLICT ("tenant_id", "module_key") DO NOTHING;

INSERT INTO "workspace_modules" ("id", "workspace_id", "module_key", "enabled", "enabled_at")
SELECT gen_random_uuid(), w."id", tm."module_key", true, NOW()
FROM "workspaces" w
INNER JOIN "tenant_modules" tm ON tm."tenant_id" = w."tenant_id" AND tm."allowed" = true
WHERE tm."module_key" IN ('sms', 'whatsapp')
ON CONFLICT ("workspace_id", "module_key") DO NOTHING;

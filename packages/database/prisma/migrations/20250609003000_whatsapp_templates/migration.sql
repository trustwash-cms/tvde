-- No-op: whatsapp_templates já criada em 20250605120000_whatsapp_templates_per_tenant
-- (schema actual: tenant_id + key). Esta migration era legado e falhava em deploy limpo.

SELECT 1;

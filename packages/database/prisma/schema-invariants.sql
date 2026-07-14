-- Invariantes do schema: falha o deploy se o Prisma disser "up to date" mas faltar estrutura.
-- Manter alinhado com schema.prisma ao adicionar módulos críticos.
\set ON_ERROR_STOP on

DO $verify$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(item, ', ' ORDER BY item)
  INTO missing
  FROM (
  SELECT 'table:stripe_connections' AS item
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stripe_connections'
  )
  UNION ALL
  SELECT 'table:stripe_payment_requests'
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stripe_payment_requests'
  )
  UNION ALL
  SELECT e.table_name || '.' || e.column_name
  FROM (
    VALUES
      ('carwash_work_sheets', 'payment_method'),
      ('carwash_work_sheets', 'stripe_payment_request_id'),
      ('stripe_payment_requests', 'source_type'),
      ('stripe_payment_requests', 'source_id'),
      ('stripe_payment_requests', 'source_label'),
      ('stripe_payment_requests', 'cancelled_at')
  ) AS e(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = e.table_name
      AND c.column_name = e.column_name
  )
  ) drift;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Schema drift: estrutura em falta (%). Corra migrate deploy ou scripts/deploy/verify-schema.sh', missing;
  END IF;
END
$verify$;

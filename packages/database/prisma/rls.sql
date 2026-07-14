-- Row-Level Security policies for multi-tenant isolation
-- Applied after Prisma migrations via docker init or manual run
-- Idempotent: safe to re-run on every deploy (DROP IF EXISTS + CREATE)

-- Helper function to get current tenant from session
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

-- Enable RLS on tenant-scoped tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE smtp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_scheduled_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies (bypass when tenant_id is NULL = master/system)
DROP POLICY IF EXISTS tenant_isolation_workspaces ON workspaces;
CREATE POLICY tenant_isolation_workspaces ON workspaces
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL OR role = 'master');

DROP POLICY IF EXISTS tenant_isolation_clients ON clients;
CREATE POLICY tenant_isolation_clients ON clients
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_products ON products;
CREATE POLICY tenant_isolation_products ON products
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_services ON services;
CREATE POLICY tenant_isolation_services ON services
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_invoices ON invoices;
CREATE POLICY tenant_isolation_invoices ON invoices
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_api_keys ON api_keys;
CREATE POLICY tenant_isolation_api_keys ON api_keys
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_webhooks ON webhooks;
CREATE POLICY tenant_isolation_webhooks ON webhooks
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_smtp ON smtp_configs;
CREATE POLICY tenant_isolation_smtp ON smtp_configs
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_email_templates ON email_templates;
CREATE POLICY tenant_isolation_email_templates ON email_templates
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_tenant_settings ON tenant_settings;
CREATE POLICY tenant_isolation_tenant_settings ON tenant_settings
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_audit ON audit_logs;
CREATE POLICY tenant_isolation_audit ON audit_logs
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_calendar_members ON calendar_members;
CREATE POLICY tenant_isolation_calendar_members ON calendar_members
  USING (
    EXISTS (
      SELECT 1 FROM calendars c
      WHERE c.id = calendar_id
        AND (c.tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
    )
  );

DROP POLICY IF EXISTS tenant_isolation_calendar_attendees ON calendar_event_attendees;
CREATE POLICY tenant_isolation_calendar_attendees ON calendar_event_attendees
  USING (
    EXISTS (
      SELECT 1 FROM calendar_events e
      WHERE e.id = event_id
        AND (e.tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
    )
  );

DROP POLICY IF EXISTS tenant_isolation_calendars ON calendars;
CREATE POLICY tenant_isolation_calendars ON calendars
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_calendar_events ON calendar_events;
CREATE POLICY tenant_isolation_calendar_events ON calendar_events
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_calendar_reminders ON calendar_event_reminders;
CREATE POLICY tenant_isolation_calendar_reminders ON calendar_event_reminders
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_calendar_attachments ON calendar_event_attachments;
CREATE POLICY tenant_isolation_calendar_attachments ON calendar_event_attachments
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_calendar_scheduled_invoices ON calendar_scheduled_invoices;
CREATE POLICY tenant_isolation_calendar_scheduled_invoices ON calendar_scheduled_invoices
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_booking_settings ON booking_settings;
CREATE POLICY tenant_isolation_booking_settings ON booking_settings
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (w.tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
    )
  );

DROP POLICY IF EXISTS tenant_isolation_booking_profiles ON booking_profiles;
CREATE POLICY tenant_isolation_booking_profiles ON booking_profiles
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_booking_catalog_items ON booking_catalog_items;
CREATE POLICY tenant_isolation_booking_catalog_items ON booking_catalog_items
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation_bookings ON bookings;
CREATE POLICY tenant_isolation_bookings ON bookings
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

import { redirect } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';

export default function AuditPage() {
  redirect(WEB_ROUTES.dashboard.settings.audit);
}

import { redirect } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';

export default function BillingIndexPage() {
  redirect(WEB_ROUTES.dashboard.billing.faturas);
}

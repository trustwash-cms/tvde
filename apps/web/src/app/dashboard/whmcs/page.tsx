import { redirect } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';

export default function WhmcsRootPage() {
  redirect(WEB_ROUTES.dashboard.whmcs.clientes);
}

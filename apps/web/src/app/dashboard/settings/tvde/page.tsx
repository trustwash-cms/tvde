import { redirect } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';

export default function TvdeSettingsPage() {
  redirect(WEB_ROUTES.dashboard.settings.tvde.sessions);
}

import { redirect } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';

export default function SettingsIndexPage() {
  redirect(WEB_ROUTES.dashboard.settings.twoFa);
}

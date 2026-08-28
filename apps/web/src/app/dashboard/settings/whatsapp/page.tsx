import { redirect } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';

export default function SettingsWhatsappIndexPage() {
  redirect(WEB_ROUTES.dashboard.settings.whatsappOfficial);
}

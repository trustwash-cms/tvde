'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { WEB_ROUTES, WHATSAPP_PROVIDER_LABELS, type WhatsappProvider } from '@tvde/shared';

const TABS: Array<{ href: string; provider: WhatsappProvider }> = [
  { href: WEB_ROUTES.dashboard.settings.whatsappOfficial, provider: 'official' },
  { href: WEB_ROUTES.dashboard.settings.whatsappGeneric, provider: 'generic' },
];

export function WhatsappSettingsTabs({ activeProvider }: { activeProvider: WhatsappProvider }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      {TABS.map((tab) => {
        const selected = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const isActiveProvider = activeProvider === tab.provider;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
              selected
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            )}
          >
            {WHATSAPP_PROVIDER_LABELS[tab.provider]}
            {isActiveProvider && (
              <span
                className={clsx(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  selected ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                )}
              >
                Activa
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

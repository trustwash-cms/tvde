'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

interface TenantWhatsappOverview {
  id: string;
  name: string;
  siteId: string;
  whatsapp: {
    connected: boolean;
    state: string;
    phoneNumber?: string;
    qrAvailable: boolean;
  };
}

export function SettingsWhatsappMasterPanel() {
  const [tenants, setTenants] = useState<TenantWhatsappOverview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<TenantWhatsappOverview[]>(API_PATHS.platform.whatsappTenantsOverview, {}, getStoredToken()).then(
      (res) => {
        if (res.data) setTenants(res.data);
        setLoading(false);
      }
    );
  }, []);

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Sessões dos clientes</h2>
        <p className="mt-1 text-sm text-slate-500">
          Estado das ligações WhatsApp de cada tenant. A sessão da plataforma é configurada acima — não
          substitui nem partilha o QR dos clientes.
        </p>
      </div>

      <p className="text-xs text-slate-500">
        Autorize o módulo em{' '}
        <Link href={WEB_ROUTES.dashboard.tenants} className="font-medium text-sky-800 underline">
          Tenants
        </Link>
        {' '}e active em{' '}
        <Link href={WEB_ROUTES.dashboard.workspaces} className="font-medium text-sky-800 underline">
          Workspaces
        </Link>
        . O superadmin do cliente emparelha o QR em Configurações → WhatsApp.
      </p>

      {loading ? (
        <p className="text-sm text-slate-400">A carregar tenants…</p>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum tenant com módulo WhatsApp autorizado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Tenant</th>
                <th className="py-2 pr-4">site_id</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2">Número</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-3 pr-4 font-medium text-slate-900">{t.name}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-600">{t.siteId}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        t.whatsapp.connected
                          ? 'bg-green-100 text-green-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {t.whatsapp.connected ? 'Ligado' : t.whatsapp.state}
                    </span>
                  </td>
                  <td className="py-3 text-slate-600">
                    {t.whatsapp.phoneNumber ? `+${t.whatsapp.phoneNumber}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

'use client';

import Link from 'next/link';
import { WEB_ROUTES, type MoloniDocumentSetHealth } from '@tvde/shared';
import { MoloniDocumentSetWarning } from '@/components/moloni/moloni-document-set-warning';

interface MoloniStatus {
  configured: boolean;
  connected: boolean;
  healthy: boolean;
  statusMessage: string;
  moduleAuthorized?: boolean;
  moduleActive?: boolean;
  companyId?: number;
  companyName?: string;
  moloniCustomerCount?: number;
  moloniInvoiceCount?: number;
  documentSetHealth?: MoloniDocumentSetHealth | null;
}

export function BillingMoloniBanner({
  workspaceId,
  moloni,
  onDocumentSetApplied,
}: {
  workspaceId: string | null;
  moloni: MoloniStatus | null;
  onDocumentSetApplied?: () => void;
}) {
  if (!workspaceId || !moloni) return null;

  if (!moloni.healthy) {
    if (moloni.documentSetHealth && !moloni.documentSetHealth.ok) {
      return (
        <MoloniDocumentSetWarning
          workspaceId={workspaceId}
          health={moloni.documentSetHealth}
          onApplied={onDocumentSetApplied}
        />
      );
    }

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">
          {moloni.moduleAuthorized === false
            ? 'Moloni indisponível neste tenant'
            : moloni.moduleActive === false
              ? 'Módulo billing inactivo'
              : moloni.configured && !moloni.connected
                ? 'OAuth Moloni pendente'
                : 'Emissão Moloni indisponível'}
        </p>
        <p className="mt-1">{moloni.statusMessage}</p>
        <p className="mt-2 text-xs">
          {moloni.moduleAuthorized === false ? (
            <>Autorize o módulo billing em Tenants antes de configurar Moloni.</>
          ) : moloni.moduleActive === false ? (
            <>Active o módulo Facturação em Configurações → Workspaces.</>
          ) : moloni.configured && !moloni.connected ? (
            <>
              Credenciais guardadas — falta OAuth.{' '}
              <Link href={WEB_ROUTES.dashboard.settings.moloni} className="font-medium underline">
                Configurações → Moloni
              </Link>
            </>
          ) : (
            <>
              Configure neste workspace em{' '}
              <Link href={WEB_ROUTES.dashboard.settings.moloni} className="font-medium underline">
                Configurações → Moloni
              </Link>
              . Cada workspace tem credenciais OAuth próprias.
            </>
          )}
        </p>
      </div>
    );
  }

  const companyLabel =
    moloni.companyName ??
    (moloni.companyId ? `Empresa ID ${moloni.companyId}` : 'Empresa não seleccionada');
  const countParts = [
    moloni.moloniCustomerCount != null
      ? `${moloni.moloniCustomerCount} clientes`
      : null,
    moloni.moloniInvoiceCount != null
      ? `${moloni.moloniInvoiceCount} faturas expostas à API`
      : null,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <MoloniDocumentSetWarning
        workspaceId={workspaceId}
        health={moloni.documentSetHealth}
        onApplied={onDocumentSetApplied}
      />
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
      <p className="font-medium">Ligação Moloni: {companyLabel}</p>
      {countParts.length > 0 && (
        <p className="mt-1 text-xs">API Moloni reporta: {countParts.join(' · ')}</p>
      )}
      <p className="mt-2 text-xs">
        O CMS importa o que a API Moloni expõe (série M/, clientes activos). Se o painel Moloni
        mostrar milhares de registos mas aqui aparecerem poucos, o histórico antigo pode não estar
        disponível via OAuth — confirme a empresa em{' '}
        <Link href={WEB_ROUTES.dashboard.settings.moloni} className="font-medium underline">
          Configurações → Moloni
        </Link>{' '}
        e contacte o suporte Moloni se necessário.
      </p>
      </div>
    </div>
  );
}

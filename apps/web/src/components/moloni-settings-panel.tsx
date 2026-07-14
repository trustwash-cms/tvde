'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getMoloniRedirectUri, isMoloniLocalRedirect, type MoloniDocumentSetHealth } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { MoloniConnectionIndicator } from '@/components/moloni-connection-indicator';
import { MoloniDocumentSetWarning } from '@/components/moloni/moloni-document-set-warning';
import { BillingMoloniBanner } from '@/components/billing/billing-moloni-banner';
import { MoloniSyncPanel } from '@/components/moloni-sync-panel';

interface MoloniStatus {
  configured: boolean;
  connected: boolean;
  healthy: boolean;
  statusMessage: string;
  moduleAuthorized?: boolean;
  moduleActive?: boolean;
  clientId?: string;
  companyId?: number;
  documentSetId?: number | null;
  companyName?: string;
  moloniCustomerCount?: number;
  moloniInvoiceCount?: number;
  redirectUri?: string;
  documentSetHealth?: MoloniDocumentSetHealth | null;
}

interface MoloniCompany {
  companyId: number;
  name: string;
}

interface MoloniSettingsPanelProps {
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export function MoloniSettingsPanel({ onSuccess, onError }: MoloniSettingsPanelProps) {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [moloni, setMoloni] = useState<MoloniStatus | null>(null);
  const [moloniCompanies, setMoloniCompanies] = useState<MoloniCompany[]>([]);
  const [statusChecking, setStatusChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [moloniForm, setMoloniForm] = useState({
    clientId: '',
    clientSecret: '',
    companyId: '',
    documentSetId: '',
    redirectUri: '',
  });

  const defaultRedirectUri = getMoloniRedirectUri();
  const redirectLooksLocal = isMoloniLocalRedirect(moloniForm.redirectUri || defaultRedirectUri);

  useEffect(() => {
    if (defaultRedirectUri) {
      setMoloniForm((f) => ({
        ...f,
        redirectUri: f.redirectUri || defaultRedirectUri,
      }));
    }
  }, [defaultRedirectUri]);

  function load() {
    if (!workspaceId) return;
    setStatusChecking(true);
    const token = getStoredToken();
    apiFetch<MoloniStatus>(
      withWorkspaceQuery(API_PATHS.billing.moloniStatus, workspaceId, { probe: '1' }),
      {},
      token
    ).then(async (res) => {
      if (res.data) {
        setMoloni(res.data);
        if (res.data.clientId) {
          setMoloniForm((f) => ({
            ...f,
            clientId: res.data!.clientId ?? f.clientId,
            companyId: res.data!.companyId ? String(res.data!.companyId) : f.companyId,
            documentSetId: res.data!.documentSetId ? String(res.data!.documentSetId) : f.documentSetId,
            redirectUri: res.data!.redirectUri ?? f.redirectUri,
          }));
        }
        if (res.data.connected) {
          const companiesRes = await apiFetch<{
            companies: MoloniCompany[];
            selectedCompanyId: number | null;
          }>(withWorkspaceQuery(API_PATHS.billing.moloniCompanies, workspaceId), {}, token);
          if (companiesRes.data?.companies) {
            setMoloniCompanies(companiesRes.data.companies);
            if (companiesRes.data.selectedCompanyId) {
              setMoloniForm((f) => ({
                ...f,
                companyId: String(companiesRes.data!.selectedCompanyId),
              }));
            }
          }
        } else {
          setMoloniCompanies([]);
        }
      } else if (res.error) {
        onError?.(res.error);
      }
      setStatusChecking(false);
    });
  }

  useEffect(() => {
    load();
  }, [workspaceId]);

  async function saveMoloniConfig(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) {
      onError?.('Seleccione um workspace');
      return;
    }
    setLoading(true);
    const payload: Record<string, string | number> = {
      workspaceId,
      clientId: moloniForm.clientId,
      redirectUri: moloniForm.redirectUri,
    };
    if (moloniForm.clientSecret) payload.clientSecret = moloniForm.clientSecret;
    if (moloniForm.companyId) payload.companyId = Number(moloniForm.companyId);
    if (moloniForm.documentSetId) payload.documentSetId = Number(moloniForm.documentSetId);

    const res = await apiFetch(API_PATHS.billing.moloniConfig, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      onSuccess?.('Configuração Moloni guardada');
      load();
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  async function connectMoloni() {
    if (!workspaceId) {
      onError?.('Seleccione um workspace');
      return;
    }
    const res = await apiFetch<{ url: string }>(
      withWorkspaceQuery(API_PATHS.billing.moloniAuthUrl, workspaceId),
      {},
      getStoredToken()
    );
    if (res.success && res.data?.url) {
      window.location.href = res.data.url;
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {workspaceId && (
            <MoloniConnectionIndicator
              healthy={statusChecking ? null : moloni?.healthy}
              statusMessage={moloni?.statusMessage}
              checking={statusChecking}
            />
          )}
          <div>
            <h2 className="text-lg font-semibold">Moloni</h2>
          </div>
        </div>
        {workspaceId && !statusChecking && (
          <button
            type="button"
            className="text-xs text-[var(--color-primary)] underline"
            onClick={load}
            disabled={loading}
          >
            Verificar ligação
          </button>
        )}
      </div>

      <WorkspaceSelector
        workspaces={workspaces}
        workspaceId={workspaceId}
        onChange={setWorkspaceId}
      />

      {!wsLoading && !workspaceId && (
        <p className="text-sm text-amber-700">Seleccione um workspace para configurar o Moloni.</p>
      )}

      {moloni?.moduleAuthorized === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Módulo billing não autorizado</p>
          <p className="mt-1 text-xs">
            Este tenant ainda não tem billing activo na plataforma. Autorize em Tenants → módulos antes de
            configurar Moloni aqui.
          </p>
        </div>
      )}

      {moloni?.moduleAuthorized && moloni.moduleActive === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Módulo billing inactivo no workspace</p>
          <p className="mt-1 text-xs">Active o módulo Facturação em Configurações → Workspaces.</p>
        </div>
      )}

      {moloni?.moduleAuthorized !== false &&
        moloni?.moduleActive !== false &&
        !statusChecking &&
        moloni &&
        !moloni.configured && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-medium">Primeira configuração</p>
            <p className="mt-1 text-xs text-slate-500">
              Preencha as credenciais Moloni Developer deste workspace, guarde e depois ligue a conta via
              OAuth. Os dados ficam associados apenas a este tenant.
            </p>
          </div>
        )}

      {moloni?.connected && moloni.documentSetHealth && (
        <MoloniDocumentSetWarning
          workspaceId={workspaceId}
          health={moloni.documentSetHealth}
          onApplied={() => {
            onSuccess?.('Série documental actualizada.');
            load();
          }}
        />
      )}

      <form onSubmit={saveMoloniConfig} className="relative grid gap-3 md:grid-cols-2" autoComplete="off">
        {/* Decoys — absorvem autofill do browser / gestores de passwords */}
        <input
          type="text"
          name="fake-username"
          autoComplete="username"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          defaultValue=""
        />
        <input
          type="password"
          name="fake-password"
          autoComplete="current-password"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          defaultValue=""
        />
        <input
          id="moloni-developer-id"
          name="moloni-developer-id"
          className="input"
          placeholder="Developer ID (client_id)"
          value={moloniForm.clientId}
          onChange={(e) => setMoloniForm({ ...moloniForm, clientId: e.target.value })}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          readOnly
          onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
          required
          disabled={!workspaceId}
        />
        <input
          id="moloni-client-secret"
          name="moloni-client-secret"
          className="input font-mono [text-security:disc] [-webkit-text-security:disc]"
          type="text"
          placeholder="Client Secret (deixe vazio para manter)"
          value={moloniForm.clientSecret}
          onChange={(e) => setMoloniForm({ ...moloniForm, clientSecret: e.target.value })}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          readOnly
          onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
          disabled={!workspaceId}
        />
        {moloniCompanies.length > 0 ? (
          <select
            className="input"
            name="moloni-company-id"
            value={moloniForm.companyId}
            onChange={(e) => setMoloniForm({ ...moloniForm, companyId: e.target.value })}
            disabled={!workspaceId}
          >
            <option value="">Seleccione a empresa Moloni</option>
            {moloniCompanies.map((c) => (
              <option key={c.companyId} value={String(c.companyId)}>
                {c.name} (ID {c.companyId})
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input"
            name="moloni-company-id"
            placeholder="Company ID Moloni (após OAuth)"
            value={moloniForm.companyId}
            onChange={(e) => setMoloniForm({ ...moloniForm, companyId: e.target.value })}
            autoComplete="off"
            disabled={!workspaceId}
          />
        )}
        {moloni?.documentSetHealth?.eligibleSets?.length ? (
          <div className="md:col-span-2 space-y-1">
            <label className="block text-xs font-medium text-slate-600">Série documental (faturas)</label>
            <select
              className="input"
              name="moloni-document-set-id"
              value={moloniForm.documentSetId}
              onChange={(e) => setMoloniForm({ ...moloniForm, documentSetId: e.target.value })}
              disabled={!workspaceId}
            >
              <option value="">Automático (série default Moloni)</option>
              {moloni.documentSetHealth.eligibleSets.map((set) => (
                <option key={set.id} value={String(set.id)}>
                  {set.name} (ID {set.id}){set.isDefault ? ' — default' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              Séries válidas para faturas com comunicação AT activa nesta empresa Moloni.
            </p>
          </div>
        ) : (
          <input
            className="input"
            name="moloni-document-set-id"
            placeholder="Document Set ID (série, opcional)"
            value={moloniForm.documentSetId}
            onChange={(e) => setMoloniForm({ ...moloniForm, documentSetId: e.target.value })}
            autoComplete="off"
            disabled={!workspaceId}
          />
        )}
        <input
          className="input md:col-span-2"
          name="moloni-redirect-uri"
          placeholder="Redirect URI OAuth"
          value={moloniForm.redirectUri}
          onChange={(e) => setMoloniForm({ ...moloniForm, redirectUri: e.target.value })}
          autoComplete="off"
          required
          disabled={!workspaceId}
        />
        {redirectLooksLocal && (
          <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Moloni não aceita localhost no Callback</p>
            <p className="mt-1 text-xs">
              Exponha a API com um túnel público (ex.{' '}
              <code className="rounded bg-amber-100 px-1">ngrok http 3001</code>
              ), copie o URL HTTPS e defina no <code className="rounded bg-amber-100 px-1">.env</code>:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-amber-100/80 p-2 text-xs">
{`NEXT_PUBLIC_API_PUBLIC_URL="https://SEU-ID.ngrok-free.app/api/v1"
# ou URI completo:
NEXT_PUBLIC_MOLONI_REDIRECT_URI="https://SEU-ID.ngrok-free.app/api/v1/billing/moloni/callback"`}
            </pre>
            <p className="mt-2 text-xs">
              Reinicie o frontend, cole o mesmo URI no painel Moloni Developer e aqui no campo acima.
            </p>
          </div>
        )}
        <p className="md:col-span-2 text-xs text-slate-500">
          O Redirect URI deve coincidir <strong>exactamente</strong> com o painel Moloni Developer:{' '}
          <code className="rounded bg-slate-100 px-1">{moloniForm.redirectUri || '…'}</code>
        </p>
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={
              loading ||
              !workspaceId ||
              moloni?.moduleAuthorized === false ||
              moloni?.moduleActive === false
            }
          >
            Guardar Moloni
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={connectMoloni}
            disabled={
              loading ||
              !moloni?.configured ||
              !workspaceId ||
              moloni?.moduleAuthorized === false ||
              moloni?.moduleActive === false
            }
          >
            Ligar conta Moloni (OAuth)
          </button>
        </div>
      </form>

      {moloni?.configured && (
        <BillingMoloniBanner
          workspaceId={workspaceId}
          moloni={moloni}
          onDocumentSetApplied={() => {
            onSuccess?.('Série documental actualizada.');
            load();
          }}
        />
      )}

      <MoloniSyncPanel
        workspaceId={workspaceId}
        healthy={Boolean(moloni?.healthy)}
        onSuccess={onSuccess}
        onError={onError}
      />
    </section>
  );
}

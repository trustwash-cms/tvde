'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { AntiAutofillInput, AutofillDecoys } from '@/components/anti-autofill';

interface BoltStatus {
  configured: boolean;
  connected: boolean;
  clientId: string | null;
  boltCompanyId: number | null;
  statusMessage: string;
  secretNeedsResave?: boolean;
  lastSyncAtOrders: string | null;
  lastSyncAtDrivers: string | null;
  lastSyncAtVehicles: string | null;
}

type SyncType = 'orders' | 'drivers' | 'vehicles' | 'all';

export function BoltSettingsPanel({
  onSuccess,
  onError,
}: {
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [status, setStatus] = useState<BoltStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState<SyncType | null>(null);
  const [form, setForm] = useState({ clientId: '', clientSecret: '', boltCompanyId: '' });

  function load() {
    if (!workspaceId) return;
    apiFetch<BoltStatus>(withWorkspaceQuery(API_PATHS.bolt.status, workspaceId), {}, getStoredToken()).then(
      (res) => {
        if (res.data) {
          setStatus(res.data);
          if (res.data.clientId) {
            setForm((f) => ({
              ...f,
              clientId: res.data!.clientId ?? f.clientId,
              boltCompanyId: res.data!.boltCompanyId ? String(res.data!.boltCompanyId) : f.boltCompanyId,
            }));
          }
        }
      }
    );
  }

  useEffect(() => {
    load();
  }, [workspaceId]);

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) {
      onError?.('Seleccione um workspace');
      return;
    }
    if (status?.secretNeedsResave && !form.clientSecret.trim()) {
      onError?.(
        'O Client Secret está ilegível — volte a colá-lo e guarde (ENCRYPTION_KEY alterada ou dados corrompidos).'
      );
      return;
    }
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.bolt.config,
      {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId,
          clientId: form.clientId,
          clientSecret: form.clientSecret || undefined,
          boltCompanyId: form.boltCompanyId ? Number(form.boltCompanyId) : undefined,
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      onSuccess?.('Configuração Bolt guardada');
      setForm((f) => ({ ...f, clientSecret: '' }));
      load();
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  async function testConnection() {
    if (!form.clientId || !form.clientSecret) {
      onError?.('Indique Client ID e Client Secret para testar');
      return;
    }
    setLoading(true);
    const res = await apiFetch<{ companyId: number }>(
      API_PATHS.bolt.testConnection,
      {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          boltCompanyId: form.boltCompanyId ? Number(form.boltCompanyId) : undefined,
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      onSuccess?.(`Ligação OK — empresa Bolt #${res.data?.companyId}`);
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  async function sync(type: SyncType) {
    if (!workspaceId) return;
    setSyncLoading(type);
    const res = await apiFetch(
      API_PATHS.bolt.sync,
      {
        method: 'POST',
        body: JSON.stringify({ workspaceId, type }),
      },
      getStoredToken()
    );
    setSyncLoading(null);
    if (res.success) {
      onSuccess?.('Sincronização concluída');
      load();
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Configurações da API Bolt</h2>
          <p className="mt-1 text-sm text-slate-500">
            Credenciais OAuth por workspace. A sincronização automática corre 1x por dia.
          </p>
        </div>
        <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
      </div>

      {!wsLoading && !workspaceId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seleccione um workspace para configurar a API Bolt.
        </div>
      )}

      {status && (
        <div className="card text-sm text-slate-600">
          <p>
            Estado:{' '}
            <span className="font-medium text-slate-900">
              {status.connected ? 'Ligado' : status.configured ? 'Configurado (verificar ligação)' : 'Não configurado'}
            </span>
            {status.boltCompanyId ? ` · Empresa #${status.boltCompanyId}` : null}
          </p>
          {status.lastSyncAtOrders && (
            <p className="mt-1 text-xs text-slate-500">
              Última sync pedidos: {new Date(status.lastSyncAtOrders).toLocaleString('pt-PT')}
            </p>
          )}
        </div>
      )}

      <form onSubmit={saveConfig} className="card relative grid gap-4 md:grid-cols-2" autoComplete="off">
        <AutofillDecoys />
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Client ID *</label>
          <AntiAutofillInput
            id="bolt-client-id"
            name="bolt-client-id"
            className="input w-full"
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Client Secret *</label>
          {status?.secretNeedsResave ? (
            <p className="mb-1 text-xs text-amber-800">
              Client Secret ilegível (ENCRYPTION_KEY alterada). Cole novamente o secret e guarde.
            </p>
          ) : null}
          <AntiAutofillInput
            id="bolt-client-secret"
            name="bolt-client-secret"
            className="input w-full"
            maskAsPassword
            value={form.clientSecret}
            onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
            placeholder={
              status?.secretNeedsResave
                ? 'Obrigatório — secret ilegível na BD'
                : 'Deixe em branco para manter o actual'
            }
            required={Boolean(status?.secretNeedsResave)}
            autoComplete="new-password"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-700">ID Empresa Bolt</label>
          <input
            className="input w-full md:max-w-xs"
            inputMode="numeric"
            value={form.boltCompanyId}
            onChange={(e) => setForm({ ...form, boltCompanyId: e.target.value.replace(/\D/g, '') })}
            placeholder="Ex.: 789"
          />
          <p className="mt-1 text-xs text-slate-500">
            Opcional se a API devolver automaticamente. Encontra-o no portal Bolt Fleet (coluna Empresa nos dados
            sincronizados).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button type="submit" className="btn-primary" disabled={loading || !workspaceId}>
            Guardar configuração
          </button>
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => void testConnection()}>
            Testar ligação
          </button>
        </div>
      </form>

      <section className="card space-y-4">
        <h3 className="font-semibold text-slate-900">Sincronização manual</h3>
        <p className="text-sm text-slate-500">Sincronize dados da API Bolt manualmente:</p>
        <div className="flex flex-wrap gap-2">
          {(['orders', 'drivers', 'vehicles', 'all'] as SyncType[]).map((type) => (
            <button
              key={type}
              type="button"
              className="btn-secondary"
              disabled={!workspaceId || syncLoading !== null}
              onClick={() => void sync(type)}
            >
              {syncLoading === type ? 'A sincronizar…' : type === 'all' ? 'Sincronizar tudo' : `Sincronizar ${type}`}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

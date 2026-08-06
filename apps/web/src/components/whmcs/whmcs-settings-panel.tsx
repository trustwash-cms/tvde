'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { AntiAutofillInput, AutofillDecoys } from '@/components/anti-autofill';

interface WhmcsStatus {
  configured: boolean;
  connected: boolean;
  isActive: boolean;
  emitOnPaid: boolean;
  sendEmailOnIssue: boolean;
  documentType: string;
  apiUrl: string;
  apiIdentifier: string;
  hasSecret: boolean;
  secretNeedsResave?: boolean;
  pollLookbackDays: number;
  lastPolledAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  egressIp?: string | null;
  whmcsIpBlocked?: boolean;
  whmcsAuthFailed?: boolean;
  blockedIp?: string | null;
  hint?: string;
}

type WhmcsTestResult = {
  ok: boolean;
  egressIp: string | null;
  sampleCount?: number;
  whmcsIpBlocked?: boolean;
  whmcsAuthFailed?: boolean;
  blockedIp?: string | null;
  hint?: string;
  error?: string;
};

function CopyIpButton({ ip }: { ip: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ml-2 rounded border border-current/30 px-2 py-0.5 text-xs font-medium hover:bg-black/5"
      onClick={() => {
        void navigator.clipboard.writeText(ip).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export function WhmcsSettingsPanel({
  onSuccess,
  onError,
}: {
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [status, setStatus] = useState<WhmcsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testBanner, setTestBanner] = useState<WhmcsTestResult | null>(null);
  const [form, setForm] = useState({
    apiUrl: '',
    apiIdentifier: '',
    apiSecret: '',
    isActive: true,
    emitOnPaid: true,
    sendEmailOnIssue: true,
    pollLookbackDays: '30',
  });

  function load() {
    if (!workspaceId) return;
    apiFetch<WhmcsStatus>(withWorkspaceQuery(API_PATHS.whmcs.status, workspaceId), {}, getStoredToken()).then(
      (res) => {
        if (res.data) {
          setStatus(res.data);
          setForm((f) => ({
            ...f,
            apiUrl: res.data!.apiUrl || f.apiUrl,
            apiIdentifier: res.data!.apiIdentifier || f.apiIdentifier,
            isActive: res.data!.isActive,
            emitOnPaid: res.data!.emitOnPaid,
            sendEmailOnIssue: res.data!.sendEmailOnIssue,
            pollLookbackDays: String(res.data!.pollLookbackDays ?? 30),
          }));
        }
      }
    );
  }

  useEffect(() => {
    load();
    setTestBanner(null);
  }, [workspaceId]);

  const egressIp = testBanner?.egressIp ?? status?.egressIp ?? null;
  const showIpBlocked =
    testBanner?.whmcsIpBlocked === true ||
    status?.whmcsIpBlocked === true ||
    Boolean(status?.lastError && /invalid\s+ip|API IP Access Restriction/i.test(status.lastError));
  const showAuthFailed =
    !showIpBlocked &&
    (testBanner?.whmcsAuthFailed === true ||
      status?.whmcsAuthFailed === true ||
      Boolean(status?.lastError && /authentication\s+failed|Identifier\/Secret/i.test(status.lastError)));
  const blockedIp =
    testBanner?.blockedIp ?? status?.blockedIp ?? egressIp ?? null;
  const ipHint =
    testBanner?.hint ??
    status?.hint ??
    (showIpBlocked && blockedIp
      ? `O IP ${blockedIp} não está autorizado na whitelist da API WHMCS. No WHMCS Admin: Configuration → System Settings → General Settings → separador Security → API IP Access Restriction → Add IP → colar ${blockedIp} → Save Changes.`
      : null);
  const authHint =
    (showAuthFailed && (testBanner?.hint || status?.hint)) ||
    (showAuthFailed
      ? 'Autenticação WHMCS falhou. Verifique Identifier/Secret (API Credentials), admin activo, permissões da API Role (GetInvoices, GetInvoice, GetClientsDetails) e regenere o secret se necessário.'
      : null);

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) {
      onError?.('Seleccione um workspace');
      return;
    }
    if (status?.secretNeedsResave && !form.apiSecret.trim()) {
      onError?.(
        'API Secret ilegível — volte a colá-lo e guarde (ENCRYPTION_KEY alterada ou dados corrompidos).'
      );
      return;
    }
    if (!status?.hasSecret && !form.apiSecret.trim()) {
      onError?.('API Secret é obrigatório na primeira configuração');
      return;
    }
    setLoading(true);
    setTestBanner(null);
    const res = await apiFetch(
      API_PATHS.whmcs.config,
      {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId,
          apiUrl: form.apiUrl,
          apiIdentifier: form.apiIdentifier,
          apiSecret: form.apiSecret || undefined,
          isActive: form.isActive,
          emitOnPaid: form.emitOnPaid,
          sendEmailOnIssue: form.sendEmailOnIssue,
          pollLookbackDays: Number(form.pollLookbackDays) || 30,
          documentType: 'invoice_receipt',
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (!res.success) {
      onError?.(getApiErrorMessage(res));
      return;
    }
    setForm((f) => ({ ...f, apiSecret: '' }));
    onSuccess?.(res.message ?? 'Configuração WHMCS guardada');
    load();

    // Testar o secret persistido (não o campo do form, que foi limpo)
    void runTest({ quietSuccessToast: true, preferStoredSecret: true });
  }

  async function runTest(opts?: {
    quietSuccessToast?: boolean;
    /** Após Guardar: usar só o secret encriptado na BD */
    preferStoredSecret?: boolean;
  }) {
    if (!workspaceId) {
      onError?.('Seleccione um workspace');
      return;
    }
    setTesting(true);
    const pasted = opts?.preferStoredSecret ? '' : form.apiSecret.trim();
    const res = await apiFetch<WhmcsTestResult>(
      API_PATHS.whmcs.testConnection,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          apiUrl: form.apiUrl,
          apiIdentifier: form.apiIdentifier,
          ...(pasted ? { apiSecret: pasted } : {}),
        }),
      },
      getStoredToken()
    );
    setTesting(false);

    const data = (res.data ?? null) as WhmcsTestResult | null;
    if (data) {
      setTestBanner(data);
      if (data.egressIp && status) {
        setStatus((s) => (s ? { ...s, egressIp: data.egressIp } : s));
      }
    }

    if (!res.success || data?.ok === false) {
      const msg =
        data?.hint ||
        (typeof (res as { hint?: string }).hint === 'string'
          ? (res as { hint?: string }).hint
          : null) ||
        getApiErrorMessage(res);
      onError?.(msg ?? 'Falha no teste');
      return;
    }

    if (!opts?.quietSuccessToast) {
      onSuccess?.(res.message ?? 'Ligação WHMCS OK');
    }
  }

  async function testConnection() {
    if (!form.apiUrl || !form.apiIdentifier) {
      onError?.('Preencha URL e Identifier para testar');
      return;
    }
    if (!form.apiSecret.trim() && !status?.hasSecret) {
      onError?.('API Secret é obrigatório na primeira configuração');
      return;
    }
    if (status?.secretNeedsResave && !form.apiSecret.trim()) {
      onError?.(
        'API Secret ilegível — volte a colá-lo e guarde (ENCRYPTION_KEY alterada ou dados corrompidos).'
      );
      return;
    }
    await runTest();
  }

  async function syncNow() {
    if (!workspaceId) return;
    setSyncing(true);
    const res = await apiFetch(
      API_PATHS.whmcs.syncPaid,
      { method: 'POST', body: JSON.stringify({ workspaceId, limit: 40 }) },
      getStoredToken()
    );
    setSyncing(false);
    if (!res.success) {
      onError?.(getApiErrorMessage(res));
      return;
    }
    const d = res.data as {
      issued?: number;
      failed?: number;
      skipped?: number;
      discovered?: number;
    } | undefined;
    onSuccess?.(
      `Sync: ${d?.discovered ?? 0} encontradas · ${d?.issued ?? 0} emitidas · ${d?.skipped ?? 0} ignoradas · ${d?.failed ?? 0} falhas`
    );
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--brand-ink)]">WHMCS → Moloni</h2>
        <p className="mt-1 text-sm text-[var(--brand-muted)]">
          Quando uma fatura fica <strong>Paga</strong> no WHMCS, a app emite fatura-recibo certificada no
          Moloni e espelha na Gestão Administrativa.
        </p>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-semibold">Desactive o plugin Moloni no WHMCS</p>
        <p className="mt-1">
          Manter o plugin activo em paralelo causa duplicados e prejuízos. A emissão certificada fica só
          nesta app. Guia:{' '}
          <code className="rounded bg-amber-100 px-1 text-xs">docs/whmcs_moloni.md</code>
        </p>
      </div>

      <WorkspaceSelector
        workspaces={workspaces}
        workspaceId={workspaceId}
        onChange={setWorkspaceId}
      />

      <div className="rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 py-3 text-sm">
        <p className="font-medium text-[var(--brand-ink)]">
          IP de saída da API:{' '}
          <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[13px]">
            {egressIp || (wsLoading ? '…' : 'a obter…')}
          </code>
          {egressIp ? <CopyIpButton ip={egressIp} /> : null}
        </p>
        <p className="mt-1 text-[var(--brand-muted)]">
          Este IP público tem de estar em <strong>API IP Access Restriction</strong> no WHMCS (Security).
          A app não adiciona o IP por si — o master adiciona-o no painel WHMCS.
        </p>
      </div>

      {testBanner?.ok === true && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Ligação WHMCS OK
          {typeof testBanner.sampleCount === 'number'
            ? ` · amostra de faturas pagas: ${testBanner.sampleCount}`
            : ''}
          {testBanner.egressIp ? (
            <span className="mt-1 block text-emerald-800/80">
              IP de saída autorizado: <code className="font-mono">{testBanner.egressIp}</code>
            </span>
          ) : null}
        </div>
      )}

      {(testBanner?.whmcsIpBlocked || (showIpBlocked && testBanner?.ok !== true)) && ipHint && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">IP bloqueado pela whitelist WHMCS</p>
          <p className="mt-1">{ipHint}</p>
          {blockedIp ? (
            <p className="mt-2 flex flex-wrap items-center gap-1">
              IP a autorizar:{' '}
              <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono">{blockedIp}</code>
              <CopyIpButton ip={blockedIp} />
            </p>
          ) : null}
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-red-900/90">
            <li>Configuration → System Settings → General Settings → Security</li>
            <li>API IP Access Restriction → Add IP</li>
            <li>Colar o IP e Save Changes</li>
          </ol>
        </div>
      )}

      {(testBanner?.whmcsAuthFailed || (showAuthFailed && testBanner?.ok !== true)) && authHint && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">Autenticação WHMCS falhou</p>
          <p className="mt-1">{authHint}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-red-900/90">
            <li>Confirmar Identifier e Secret (Manage API Credentials — não o login de admin)</li>
            <li>Admin associado à credencial activo</li>
            <li>API Role com GetInvoices, GetInvoice e GetClientsDetails</li>
            <li>Se o secret se perdeu: regenerar, colar na app e Guardar</li>
          </ol>
        </div>
      )}

      {status?.secretNeedsResave && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          API Secret ilegível (ENCRYPTION_KEY alterada). Cole novamente o secret e guarde.
        </div>
      )}

      {status?.lastError &&
        !status.secretNeedsResave &&
        !(showIpBlocked && ipHint) &&
        !(showAuthFailed && authHint) && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {status.lastError}
        </div>
      )}
      <form onSubmit={saveConfig} className="card space-y-4 p-4">
        <AutofillDecoys />
        <div>
          <label className="mb-1 block text-sm font-medium">URL API WHMCS</label>
          <AntiAutofillInput
            className="input w-full"
            value={form.apiUrl}
            onChange={(e) => setForm((f) => ({ ...f, apiUrl: e.target.value }))}
            placeholder="https://teu-dominio.pt/includes/api.php"
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">API Identifier</label>
            <AntiAutofillInput
              className="input w-full"
              value={form.apiIdentifier}
              onChange={(e) => setForm((f) => ({ ...f, apiIdentifier: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              API Secret {status?.hasSecret && !status.secretNeedsResave ? '(deixar vazio para manter)' : ''}
            </label>
            <AntiAutofillInput
              className="input w-full"
              type="password"
              value={form.apiSecret}
              onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))}
              placeholder={status?.hasSecret ? 'Nova secret (opcional)' : 'Secret'}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Integração activa
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.emitOnPaid}
              onChange={(e) => setForm((f) => ({ ...f, emitOnPaid: e.target.checked }))}
            />
            Emitir Moloni ao pagar
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.sendEmailOnIssue}
              onChange={(e) => setForm((f) => ({ ...f, sendEmailOnIssue: e.target.checked }))}
            />
            Enviar email após emissão
          </label>
          <div>
            <label className="mb-1 block text-sm font-medium">Lookback poll (dias)</label>
            <input
              className="input w-full"
              type="number"
              min={1}
              max={365}
              value={form.pollLookbackDays}
              onChange={(e) => setForm((f) => ({ ...f, pollLookbackDays: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'A guardar…' : 'Guardar'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void testConnection()} disabled={testing}>
            {testing ? 'A testar…' : 'Testar ligação'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void syncNow()} disabled={syncing || !status?.configured}>
            {syncing ? 'A sincronizar…' : 'Sincronizar pagas agora'}
          </button>
          <Link href={WEB_ROUTES.dashboard.whmcs.faturas} className="btn-secondary inline-flex items-center">
            Ver faturas WHMCS
          </Link>
        </div>

        {status?.lastPolledAt && (
          <p className="text-xs text-[var(--brand-muted)]">
            Último poll: {new Date(status.lastPolledAt).toLocaleString('pt-PT')}
          </p>
        )}
      </form>
    </div>
  );
}

'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getMoloniRedirectUri, isMoloniLocalRedirect, type MoloniDocumentSetHealth } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { MoloniConnectionIndicator } from '@/components/moloni-connection-indicator';
import { MoloniDocumentSetWarning } from '@/components/moloni/moloni-document-set-warning';
import { BillingMoloniBanner } from '@/components/billing/billing-moloni-banner';
import { MoloniSyncPanel } from '@/components/moloni-sync-panel';
import {
  MoloniBillingEmailPanel,
  type BillingEmailSettingsData,
} from '@/components/moloni-billing-email-panel';

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
  defaultProductCategoryId?: number | null;
  companyName?: string;
  isDemoCompany?: boolean;
  moloniCustomerCount?: number;
  moloniInvoiceCount?: number;
  redirectUri?: string;
  documentSetHealth?: MoloniDocumentSetHealth | null;
  emailSettings?: BillingEmailSettingsData | null;
  /** Client Secret encriptado ilegível — é preciso voltar a guardá-lo */
  secretNeedsResave?: boolean;
}

interface MoloniCompany {
  companyId: number;
  name: string;
}

interface MoloniCategoryOption {
  category_id: number;
  name: string;
}

interface MoloniSettingsPanelProps {
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export function MoloniSettingsPanel({ onSuccess, onError }: MoloniSettingsPanelProps) {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [moloni, setMoloni] = useState<MoloniStatus | null>(null);
  const [moloniCompanies, setMoloniCompanies] = useState<MoloniCompany[]>([]);
  const [moloniCategories, setMoloniCategories] = useState<MoloniCategoryOption[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [purgingDemo, setPurgingDemo] = useState(false);
  const [moloniForm, setMoloniForm] = useState({
    clientId: '',
    clientSecret: '',
    companyId: '',
    documentSetId: '',
    defaultProductCategoryId: '',
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

  async function loadCategories(wsId: string, token: string | null) {
    setCategoriesLoading(true);
    const res = await apiFetch<{ items: MoloniCategoryOption[]; total: number }>(
      withWorkspaceQuery(API_PATHS.billing.productCategories, wsId, {
        parentId: '0',
        page: '0',
        limit: '50',
      }),
      {},
      token
    );
    setCategoriesLoading(false);
    if (res.data?.items) {
      setMoloniCategories(res.data.items);
    } else {
      setMoloniCategories([]);
    }
  }

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
            defaultProductCategoryId: res.data!.defaultProductCategoryId
              ? String(res.data!.defaultProductCategoryId)
              : '',
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
          await loadCategories(workspaceId, token);
        } else {
          setMoloniCompanies([]);
          setMoloniCategories([]);
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
    const payload: Record<string, string | number | null> = {
      workspaceId,
      clientId: moloniForm.clientId,
      redirectUri: moloniForm.redirectUri,
    };
    if (moloniForm.clientSecret) payload.clientSecret = moloniForm.clientSecret;
    if (moloniForm.companyId) payload.companyId = Number(moloniForm.companyId);
    if (moloniForm.documentSetId) payload.documentSetId = Number(moloniForm.documentSetId);
    payload.defaultProductCategoryId = moloniForm.defaultProductCategoryId
      ? Number(moloniForm.defaultProductCategoryId)
      : null;

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

  async function syncCatalogAndReloadCategories() {
    if (!workspaceId) return;
    setLoading(true);
    onError?.('');
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.syncCatalog, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    if (!res.success) {
      setLoading(false);
      onError?.(getApiErrorMessage(res));
      return;
    }
    await loadCategories(workspaceId, getStoredToken());
    setLoading(false);
    onSuccess?.('Catálogo sincronizado — seleccione a categoria por defeito abaixo');
    load();
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

  async function purgeDemoData() {
    if (!workspaceId || !moloni?.isDemoCompany) return;
    const ok = await confirm({
      title: 'Limpar dados do modo demonstração',
      message:
        'Apaga no CMS deste workspace:\n' +
        '• Documentos / faturas (rascunhos e emitidos) e tokens de download PDF\n' +
        '• Catálogo local (séries, impostos; categorias/artigos só existem na cloud Moloni)\n' +
        '• Clientes e fornecedores de facturação (Entidades de facturação)\n\n' +
        'Mantém a ligação OAuth, a série documental e o email/SMTP. A categoria por defeito é limpa. ' +
        'O módulo CRM «Clientes» não é afectado. ' +
        'Os dados na cloud Moloni (demo) NÃO são apagados — limpe-os na interface Moloni se precisar. Continuar?',
      confirmLabel: 'Limpar dados demo',
      variant: 'danger',
    });
    if (!ok) return;

    setPurgingDemo(true);
    onError?.('');
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.moloniPurgeDemoData, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setPurgingDemo(false);
    if (res.success) {
      const d = res.data as {
        invoicesDeleted?: number;
        catalogCleared?: number;
        entitiesDeleted?: number;
      };
      onSuccess?.(
        res.message ??
          `Dados demo limpos: ${d.invoicesDeleted ?? 0} documentos, ${d.catalogCleared ?? 0} itens de catálogo, ` +
            `${d.entitiesDeleted ?? 0} entidades de facturação eliminadas. Use «Sincronizar agora» para continuar a testar.`
      );
      load();
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  return (
    <section className="card space-y-4">
      {confirmDialog}
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
          placeholder={
            moloni?.secretNeedsResave
              ? 'Client Secret (obrigatório — volte a colar)'
              : 'Client Secret (deixe vazio para manter)'
          }
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
          required={Boolean(moloni?.secretNeedsResave)}
          disabled={!workspaceId}
        />
        {moloni?.secretNeedsResave && (
          <p className="md:col-span-2 text-xs text-amber-800">
            O Client Secret guardado está ilegível (provavelmente após mudança de{' '}
            <code className="rounded bg-amber-100 px-1">ENCRYPTION_KEY</code>). Cole o secret
            novamente, guarde, e depois use «Ligar conta Moloni (OAuth)».
          </p>
        )}
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

        {moloni?.connected && (
          <div className="md:col-span-2 space-y-2">
            <label className="block text-xs font-medium text-slate-600">
              Categoria por defeito (linhas manuais)
            </label>
            <p className="text-xs text-slate-500">
              Quando emite uma fatura com linha manual, o CMS cria o artigo Moloni nesta categoria
              (obrigatório — sem categoria a emissão falha).
            </p>
            {categoriesLoading ? (
              <p className="text-xs text-slate-400">A carregar categorias…</p>
            ) : moloniCategories.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">Sem categorias Moloni</p>
                <p className="mt-1 text-xs">
                  Sincronize o catálogo primeiro (ou crie categorias no Moloni) e depois escolha a
                  categoria por defeito.
                </p>
                <button
                  type="button"
                  className="btn-secondary mt-2 text-xs"
                  onClick={() => void syncCatalogAndReloadCategories()}
                  disabled={loading || !workspaceId}
                >
                  Sincronizar catálogo e actualizar lista
                </button>
              </div>
            ) : (
              <select
                className="input"
                name="moloni-default-category-id"
                value={moloniForm.defaultProductCategoryId}
                onChange={(e) =>
                  setMoloniForm({ ...moloniForm, defaultProductCategoryId: e.target.value })
                }
                disabled={!workspaceId}
              >
                <option value="">Seleccione uma categoria…</option>
                {moloniCategories.map((cat) => (
                  <option key={cat.category_id} value={String(cat.category_id)}>
                    {cat.name} (ID {cat.category_id})
                  </option>
                ))}
              </select>
            )}
            {!moloniForm.defaultProductCategoryId && moloniCategories.length > 0 && (
              <p className="text-xs text-amber-700">
                Sem categoria por defeito, a emissão de linhas manuais falhará.
              </p>
            )}
          </div>
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
              Em produção use a API pública. Em desenvolvimento, exponha a API com um túnel HTTPS
              (Cloudflare Tunnel ou <code className="rounded bg-amber-100 px-1">ngrok http 3002</code>
              ) e defina no <code className="rounded bg-amber-100 px-1">.env</code>:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-amber-100/80 p-2 text-xs">
{`# Produção tvde.one:
NEXT_PUBLIC_MOLONI_REDIRECT_URI="https://api.tvde.one/api/v1/billing/moloni/callback"
# Dev (túnel):
# NEXT_PUBLIC_MOLONI_REDIRECT_URI="https://SEU-ID.ngrok-free.app/api/v1/billing/moloni/callback"`}
            </pre>
            <p className="mt-2 text-xs">
              Reinicie o frontend, cole o mesmo URI no painel Moloni Developer e aqui no campo acima.
            </p>
          </div>
        )}
        <p className="md:col-span-2 text-xs text-slate-500">
          O Redirect URI deve coincidir <strong>exactamente</strong> com o painel Moloni Developer
          (produção: <code className="rounded bg-slate-100 px-1">https://api.tvde.one/api/v1/billing/moloni/callback</code>
          ):{' '}
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
              moloni?.secretNeedsResave ||
              moloni?.moduleAuthorized === false ||
              moloni?.moduleActive === false
            }
            title={
              moloni?.secretNeedsResave
                ? 'Guarde o Client Secret antes de autorizar OAuth'
                : undefined
            }
          >
            Ligar conta Moloni (OAuth)
          </button>
        </div>
      </form>

      {moloni?.configured && (
        <MoloniBillingEmailPanel
          workspaceId={workspaceId}
          companyName={moloni.companyName}
          initial={moloni.emailSettings}
          disabled={
            moloni.moduleAuthorized === false ||
            moloni.moduleActive === false ||
            !workspaceId
          }
          onSuccess={onSuccess}
          onError={onError}
          onSaved={(data) =>
            setMoloni((prev) => (prev ? { ...prev, emailSettings: data } : prev))
          }
        />
      )}

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

      {moloni?.connected && (
        <section className="space-y-3 rounded-lg border border-red-200 bg-red-50/60 p-4">
          <div>
            <h3 className="text-sm font-semibold text-red-900">Zona de perigo</h3>
            <p className="mt-1 text-xs text-red-800/90">
              Acções destrutivas para limpar testes em modo demonstração Moloni, sem afectar a
              ligação OAuth nem as definições de email.
            </p>
          </div>

          {moloni.isDemoCompany ? (
            <>
              <p className="text-xs text-red-900/80">
                Empresa demo detectada
                {moloni.companyName ? (
                  <>
                    : <strong>{moloni.companyName}</strong>
                  </>
                ) : null}
                . Apaga documentos/faturas, tokens de download, catálogo local (séries/impostos) e
                clientes/fornecedores de facturação, para voltar a testar do zero. Mantém OAuth,
                série e email/SMTP; limpa a categoria por defeito. Dados na cloud Moloni (demo)
                podem continuar a existir.
              </p>
              <button
                type="button"
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                disabled={loading || purgingDemo || !workspaceId}
                onClick={() => void purgeDemoData()}
              >
                {purgingDemo ? 'A limpar…' : 'Limpar dados do modo demonstração'}
              </button>
            </>
          ) : (
            <p className="text-xs text-red-900/80">
              A limpeza de dados demo só está disponível quando a empresa Moloni ligada é de
              demonstração (nome com «Demonstração»). Empresa actual
              {moloni.companyName ? (
                <>
                  : <strong>{moloni.companyName}</strong>
                </>
              ) : (
                ' desconhecida'
              )}
              .
            </p>
          )}
        </section>
      )}
    </section>
  );
}

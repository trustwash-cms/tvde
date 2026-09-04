'use client';

import {
  useEffect,
  useMemo,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import {
  RECIBOS_VERDES_BASES_IRS,
  RECIBOS_VERDES_DOCUMENTO_TIPOS,
  RECIBOS_VERDES_IMPOSTO_SELO,
  RECIBOS_VERDES_LINHA_TIPOS,
  RECIBOS_VERDES_MOTIVOS_EMISSAO,
  RECIBOS_VERDES_MOTIVOS_ISENCAO,
  RECIBOS_VERDES_TAXAS_IVA,
  RECIBOS_VERDES_TAXAS_RETENCAO_IRS,
  RECIBOS_VERDES_TIPO_REF,
  createBlankRecibosVerdesDraft,
  createEmptyRecibosVerdesLinha,
  createRecibosVerdesDraftExample,
  createRecibosVerdesLinhaId,
  draftShowsIrsSection,
  formatLinhaReferenciaDescricaoAt,
  formatPtMoney,
  lineTotalComImposto,
  parseIvaPercent,
  recibosVerdesNeedsRetencaoIrs,
  summarizeRecibosVerdesDraft,
  type RecibosVerdesCatalogItem,
  type RecibosVerdesDraft,
  type RecibosVerdesDraftLinha,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import {
  findAdquirenteLocal,
  loadRecibosVerdesCatalog,
  parseMoradaPt,
  upsertAdquirenteLocal,
  upsertRecibosVerdesCatalogItem,
  upsertRecibosVerdesLocalDoc,
  type RecibosVerdesLocalDoc,
} from '@/lib/recibos-verdes-local';
import { downloadRecibosVerdesDraftPdf } from '@/lib/recibos-verdes-draft-pdf';

const AT_BLUE = '#0073bb';
const AT_BORDER = '#d0d0d0';
const AT_ROW_BG = '#eff8fe';

function Field({
  label,
  children,
  className = '',
  hint,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: boolean;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-center gap-1 text-[13px] font-bold text-[#333]">
        {label}
        {hint ? <HelpCircle size={12} className="text-[#333]" aria-hidden /> : null}
      </span>
      {children}
    </label>
  );
}

function AtInput({ className = '', style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-[2px] border bg-white px-2.5 py-1.5 text-[13px] text-[#333] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none focus:border-[#0073bb] ${className}`}
      style={{ borderColor: AT_BORDER, ...style }}
    />
  );
}

function AtSelect({
  className = '',
  style,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-[2px] border bg-white px-2.5 py-1.5 text-[13px] text-[#333] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none focus:border-[#0073bb] ${className}`}
      style={{ borderColor: AT_BORDER, ...style }}
    >
      {children}
    </select>
  );
}

function AtTextarea({
  className = '',
  style,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full min-h-[72px] rounded-[2px] border bg-white px-2.5 py-1.5 text-[13px] text-[#333] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none focus:border-[#0073bb] ${className}`}
      style={{ borderColor: AT_BORDER, ...style }}
    />
  );
}

function SuffixField({ suffix, children }: { suffix: string; children: ReactNode }) {
  return (
    <div className="flex">
      <div className="min-w-0 flex-1 [&_input]:rounded-r-none">{children}</div>
      <span
        className="inline-flex items-center border border-l-0 bg-[#f5f5f5] px-2.5 text-[13px] text-[#555]"
        style={{ borderColor: AT_BORDER }}
      >
        {suffix}
      </span>
    </div>
  );
}

function AtSection({
  title,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden border bg-white" style={{ borderColor: AT_BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[14px] font-bold text-white"
        style={{ backgroundColor: AT_BLUE }}
        onClick={() => (collapsible ? setOpen((v) => !v) : undefined)}
        aria-expanded={open}
      >
        <span>{title}</span>
        {collapsible ? (
          <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        ) : null}
      </button>
      {open ? <div className="space-y-3 p-4">{children}</div> : null}
    </section>
  );
}

function linhaToCatalog(linha: RecibosVerdesDraftLinha): RecibosVerdesCatalogItem {
  return {
    id: linha.id || createRecibosVerdesLinhaId(),
    tipo: linha.tipo,
    tipoRef: linha.tipoRef,
    referencia: linha.referencia.trim(),
    descricao: linha.descricao.trim(),
    unidade: linha.unidade,
    precoUnitarioSemIva: linha.precoUnitarioSemIva,
    taxaIva: linha.taxaIva,
    motivoIsencao: linha.motivoIsencao,
    updatedAt: new Date().toISOString(),
  };
}

export function AdminMgmtRecibosVerdesDraft({
  workspaceId,
  initialDraft,
  onLocalDocsChange,
}: {
  workspaceId: string;
  initialDraft?: RecibosVerdesDraft | null;
  onLocalDocsChange?: () => void;
}) {
  const [draft, setDraft] = useState<RecibosVerdesDraft>(() => {
    if (initialDraft) return initialDraft;
    return createBlankRecibosVerdesDraft();
  });
  const [catalog, setCatalog] = useState<RecibosVerdesCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nifLookupMsg, setNifLookupMsg] = useState('');
  const [nifLookingUp, setNifLookingUp] = useState(false);
  const [modalLinha, setModalLinha] = useState<RecibosVerdesDraftLinha | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveToCatalog, setSaveToCatalog] = useState(true);

  useEffect(() => {
    setCatalog(loadRecibosVerdesCatalog(workspaceId));
  }, [workspaceId]);

  const totals = useMemo(() => summarizeRecibosVerdesDraft(draft), [draft]);
  const showIrs = draftShowsIrsSection(draft);
  const showRetencao = showIrs && recibosVerdesNeedsRetencaoIrs(draft.baseIncidenciaIrs);

  function update<K extends keyof RecibosVerdesDraft>(key: K, value: RecibosVerdesDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function applyAdquirente(data: {
    nif: string;
    nome: string;
    pais?: string;
    morada?: string;
    codigoPostal?: string;
    localidade?: string;
  }) {
    const parsed = parseMoradaPt(data.morada || '');
    setDraft((prev) => ({
      ...prev,
      adquirenteNif: data.nif.replace(/\D/g, ''),
      adquirenteNome: data.nome || prev.adquirenteNome,
      adquirentePais: data.pais || prev.adquirentePais || 'Portugal',
      adquirenteMorada: parsed.morada || data.morada || prev.adquirenteMorada,
      adquirenteCodigoPostal:
        data.codigoPostal || parsed.codigoPostal || prev.adquirenteCodigoPostal,
      adquirenteLocalidade:
        data.localidade || parsed.localidade || prev.adquirenteLocalidade,
    }));
  }

  async function procurarAdquirentePorNif(nifRaw?: string) {
    const nif = (nifRaw ?? draft.adquirenteNif).replace(/\D/g, '');
    if (nif.length < 9) {
      setNifLookupMsg('Introduza um NIF com 9 dígitos.');
      return;
    }
    setNifLookingUp(true);
    setNifLookupMsg('');

    const local = findAdquirenteLocal(workspaceId, nif);
    if (local) {
      applyAdquirente(local);
      setNifLookingUp(false);
      setNifLookupMsg('Dados preenchidos a partir de referência local. Pode alterar se estiverem incorrectos.');
      return;
    }

    const res = await apiFetch<{
      module: Array<{ nome: string; nif: string | null; morada: string | null }>;
      crm: Array<{ nome: string; nif: string | null; morada: string | null }>;
      billing: Array<{ nome: string; nif: string | null; morada: string | null }>;
    }>(
      withWorkspaceQuery(API_PATHS.adminMgmt.clienteLookup, workspaceId, { q: nif }),
      {},
      getStoredToken()
    );
    setNifLookingUp(false);

    const hit =
      res.data?.module.find((c) => (c.nif || '').replace(/\D/g, '') === nif) ||
      res.data?.billing.find((c) => (c.nif || '').replace(/\D/g, '') === nif) ||
      res.data?.crm.find((c) => (c.nif || '').replace(/\D/g, '') === nif) ||
      res.data?.module[0] ||
      res.data?.billing[0] ||
      res.data?.crm[0];

    if (hit) {
      applyAdquirente({
        nif,
        nome: hit.nome,
        morada: hit.morada || '',
        pais: 'Portugal',
      });
      setNifLookupMsg(
        'Dados preenchidos a partir dos clientes do workspace. Pode alterar se estiverem incorrectos.'
      );
      return;
    }

    setDraft((prev) => ({ ...prev, adquirenteNif: nif }));
    setNifLookupMsg(
      'NIF não encontrado localmente. Preencha os dados do cliente (como na AT após procurar).'
    );
  }

  function openAddLinha() {
    setEditingId(null);
    setSaveToCatalog(true);
    setModalLinha(createEmptyRecibosVerdesLinha());
  }

  function openEditLinha(linha: RecibosVerdesDraftLinha) {
    setEditingId(linha.id);
    setSaveToCatalog(false);
    setModalLinha({ ...linha });
  }

  function applyCatalogItem(item: RecibosVerdesCatalogItem) {
    setModalLinha((prev) =>
      prev
        ? {
            ...prev,
            tipo: item.tipo,
            tipoRef: item.tipoRef,
            referencia: item.referencia,
            descricao: item.descricao,
            unidade: item.unidade,
            precoUnitarioSemIva: item.precoUnitarioSemIva,
            taxaIva: item.taxaIva,
            motivoIsencao: item.motivoIsencao,
          }
        : prev
    );
  }

  function guardarLinha() {
    if (!modalLinha) return;
    if (!modalLinha.descricao.trim()) {
      setError('Indique a descrição do produto/serviço.');
      return;
    }
    const linha: RecibosVerdesDraftLinha = {
      ...modalLinha,
      id: editingId ?? modalLinha.id ?? createRecibosVerdesLinhaId(),
    };
    setDraft((prev) => {
      const exists = prev.linhas.some((l) => l.id === linha.id);
      return {
        ...prev,
        linhas: exists
          ? prev.linhas.map((l) => (l.id === linha.id ? linha : l))
          : [...prev.linhas, linha],
      };
    });
    if (saveToCatalog && (linha.referencia.trim() || linha.descricao.trim())) {
      setCatalog(upsertRecibosVerdesCatalogItem(workspaceId, linhaToCatalog(linha)));
    }
    setModalLinha(null);
    setError('');
  }

  async function emitirPdf() {
    setBusy(true);
    setError('');
    try {
      if (draft.adquirenteNif.trim() && draft.adquirenteNome.trim()) {
        upsertAdquirenteLocal(workspaceId, {
          nif: draft.adquirenteNif,
          nome: draft.adquirenteNome,
          pais: draft.adquirentePais || 'Portugal',
          morada: draft.adquirenteMorada,
          codigoPostal: draft.adquirenteCodigoPostal,
          localidade: draft.adquirenteLocalidade,
        });
      }
      await downloadRecibosVerdesDraftPdf(draft);
      const doc: RecibosVerdesLocalDoc = {
        id: `rv_${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
        situacao: 'emitido',
        referencia: `RASCUNHO/${new Date().toISOString().slice(0, 10)}`,
        tipoDocumento: draft.tipoDocumento.toUpperCase(),
        clienteNome: draft.adquirenteNome,
        clienteNif: draft.adquirenteNif,
        dataPrestacao: draft.dataPrestacao,
        total: summarizeRecibosVerdesDraft(draft).totalDocumento,
        draft: structuredClone(draft),
      };
      upsertRecibosVerdesLocalDoc(workspaceId, doc);
      onLocalDocsChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar PDF');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden border bg-[#f7f7f7] font-sans" style={{ borderColor: AT_BORDER }}>
      <div
        className="border-b bg-[#fff8e6] px-4 py-2 text-[12px] text-[#7a5c00]"
        style={{ borderColor: '#f0e0a8' }}
      >
        Rascunho local — não emite no Portal das Finanças. O transmitente é a conta AT ligada (login).
        Preencha o Adquirente (cliente) — ao indicar o NIF, tentamos preencher o resto.
      </div>

      <div className="space-y-4 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px]" style={{ color: AT_BLUE }}>
              Faturas e Recibos &gt; Emitir &gt; Emitir Faturas ou Faturas-Recibos
            </p>
            <h3 className="mt-1 text-[22px] font-bold leading-tight text-[#333]">Emitir Faturas</h3>
            <p className="mt-0.5 text-[13px] text-[#666]">
              Emita aqui uma Fatura ou Fatura-Recibo
              <span className="ml-1 text-[11px] font-medium text-amber-700">(rascunho TVDE)</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-[3px] border bg-white px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-[#444] hover:bg-[#f5f5f5]"
              style={{ borderColor: AT_BORDER }}
              onClick={() => {
                setDraft(createBlankRecibosVerdesDraft());
                setNifLookupMsg('');
                setError('');
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="rounded-[3px] border bg-white px-3 py-1.5 text-[12px] font-semibold text-[#444]"
              style={{ borderColor: AT_BORDER }}
              onClick={() => setDraft(createRecibosVerdesDraftExample())}
            >
              Exemplo fatura 24
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-[3px] px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-white disabled:opacity-60"
              style={{ backgroundColor: AT_BLUE }}
              onClick={() => void emitirPdf()}
            >
              {busy ? 'A gerar…' : 'Emitir PDF'}
            </button>
          </div>
        </div>

        <div className="h-px w-full" style={{ backgroundColor: AT_BLUE }} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <AtSection title="Emissão">
          <p className="text-[12px] text-[#666]">
            Se não se encontra registado pelo exercício de uma atividade na data da operação, a
            Fatura ou Fatura-Recibo a emitir deve ser de ato isolado.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data da transação" hint>
              <AtInput
                type="date"
                value={draft.dataPrestacao}
                onChange={(e) => update('dataPrestacao', e.target.value)}
              />
            </Field>
            <Field label="Tipo">
              <AtSelect
                value={draft.tipoDocumento}
                onChange={(e) =>
                  update('tipoDocumento', e.target.value as RecibosVerdesDraft['tipoDocumento'])
                }
              >
                {RECIBOS_VERDES_DOCUMENTO_TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </AtSelect>
            </Field>
          </div>
        </AtSection>

        <AtSection title="Adquirente">
          <p className="text-[12px] text-[#666]">
            Cliente a quem vai passar a fatura. Ao preencher o NIF (9 dígitos) ou clicar em Procurar,
            os restantes campos são preenchidos automaticamente quando existirem — pode corrigir
            depois.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
            <Field label="País" hint>
              <AtSelect
                value={draft.adquirentePais}
                onChange={(e) => update('adquirentePais', e.target.value)}
              >
                <option value="Portugal">Portugal</option>
                <option value="Espanha">Espanha</option>
                <option value="Outro">Outro</option>
              </AtSelect>
            </Field>
            <Field label="NIF">
              <AtInput
                value={draft.adquirenteNif}
                inputMode="numeric"
                maxLength={9}
                onChange={(e) => {
                  const nif = e.target.value.replace(/\D/g, '').slice(0, 9);
                  update('adquirenteNif', nif);
                  setNifLookupMsg('');
                  if (nif.length === 9) void procurarAdquirentePorNif(nif);
                }}
                onBlur={() => {
                  if (draft.adquirenteNif.replace(/\D/g, '').length === 9) {
                    void procurarAdquirentePorNif();
                  }
                }}
              />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                disabled={nifLookingUp}
                className="rounded-[3px] border bg-white px-4 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#444] disabled:opacity-60"
                style={{ borderColor: AT_BORDER }}
                onClick={() => void procurarAdquirentePorNif()}
              >
                {nifLookingUp ? '…' : 'Procurar'}
              </button>
            </div>
          </div>
          {nifLookupMsg ? <p className="text-[12px] text-[#555]">{nifLookupMsg}</p> : null}
          <Field label="Nome">
            <AtInput
              value={draft.adquirenteNome}
              onChange={(e) => update('adquirenteNome', e.target.value)}
            />
          </Field>
          <div className="space-y-3 border-t pt-3" style={{ borderColor: AT_BORDER }}>
            <p className="text-[13px] font-bold text-[#333]">Morada de Cliente</p>
            <Field label="Morada">
              <AtInput
                value={draft.adquirenteMorada}
                onChange={(e) => update('adquirenteMorada', e.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Código Postal">
                <AtInput
                  value={draft.adquirenteCodigoPostal}
                  onChange={(e) => update('adquirenteCodigoPostal', e.target.value)}
                  placeholder="1250-053"
                />
              </Field>
              <Field label="Localidade">
                <AtInput
                  value={draft.adquirenteLocalidade}
                  onChange={(e) => update('adquirenteLocalidade', e.target.value)}
                />
              </Field>
            </div>
            <Field label="País">
              <AtSelect
                value={draft.adquirentePais}
                onChange={(e) => update('adquirentePais', e.target.value)}
              >
                <option value="Portugal">Portugal</option>
                <option value="Espanha">Espanha</option>
                <option value="Outro">Outro</option>
              </AtSelect>
            </Field>
          </div>
        </AtSection>

        <AtSection title="Motivo de Emissão">
          <Field label="Documento emitido a título de">
            <AtSelect
              value={draft.motivoEmissao}
              onChange={(e) => update('motivoEmissao', e.target.value)}
            >
              {RECIBOS_VERDES_MOTIVOS_EMISSAO.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </AtSelect>
          </Field>
        </AtSection>

        <AtSection title="Produtos, Serviços ou Outros" collapsible>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-left text-[#555]">
                  <th className="pb-2 font-bold">Referência / Descrição</th>
                  <th className="pb-2 font-bold">Taxa IVA</th>
                  <th className="pb-2 text-right font-bold">Total c/Imposto</th>
                  <th className="pb-2 text-right font-bold">Ações</th>
                </tr>
                <tr>
                  <td colSpan={4} className="h-px" style={{ backgroundColor: AT_BLUE }} />
                </tr>
              </thead>
              <tbody>
                {draft.linhas.length === 0 ? (
                  <tr style={{ backgroundColor: AT_ROW_BG }}>
                    <td colSpan={4} className="px-2 py-3 text-[#666]">
                      Sem linhas. Clique em ADICIONAR.
                    </td>
                  </tr>
                ) : (
                  draft.linhas.map((linha) => {
                    const fmt = formatLinhaReferenciaDescricaoAt(linha);
                    return (
                    <tr key={linha.id} style={{ backgroundColor: AT_ROW_BG }}>
                      <td className="border-y px-2 py-2" style={{ borderColor: '#b8d4ea' }}>
                        <p className="font-medium text-[#333]">{fmt.linha1}</p>
                        <p className="text-[12px] text-[#555]">{fmt.linha2}</p>
                        <p className="text-[12px] text-[#555]">{fmt.linha3}</p>
                      </td>
                      <td
                        className="border-y px-2 py-2 whitespace-nowrap"
                        style={{ borderColor: '#b8d4ea' }}
                      >
                        {formatPtMoney(parseIvaPercent(linha.taxaIva))}%
                        {parseIvaPercent(linha.taxaIva) === 0 ? ' a)' : ''}
                      </td>
                      <td
                        className="border-y px-2 py-2 text-right tabular-nums"
                        style={{ borderColor: '#b8d4ea' }}
                      >
                        {formatPtMoney(lineTotalComImposto(linha))} €
                      </td>
                      <td
                        className="border-y px-2 py-2 text-right"
                        style={{ borderColor: '#b8d4ea' }}
                      >
                        <button
                          type="button"
                          className="rounded-[3px] border bg-white px-3 py-1 text-[12px] font-semibold uppercase text-[#444]"
                          style={{ borderColor: AT_BORDER }}
                          onClick={() => openEditLinha(linha)}
                        >
                          Alterar
                        </button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="text-[13px] font-bold uppercase tracking-wide"
            style={{ color: AT_BLUE }}
            onClick={openAddLinha}
          >
            Adicionar
          </button>
        </AtSection>

        {draft.linhas.length > 0 ? (
          <AtSection title="Taxas de IVA" collapsible>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="text-left text-[#888]">
                    <th className="pb-2 font-medium">
                      Taxa | Motivo de isenção/não sujeição/não tributação
                    </th>
                    <th className="pb-2 text-right font-medium">Valor Tributável</th>
                    <th className="pb-2 text-right font-medium">Valor do IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.porTaxa.map((row) => (
                    <tr key={`${row.taxa}|${row.motivo}`} style={{ backgroundColor: AT_ROW_BG }}>
                      <td className="border-y px-2 py-2" style={{ borderColor: '#b8d4ea' }}>
                        {row.taxa}
                        {row.motivo ? ` - a) ${row.motivo}` : ''}
                      </td>
                      <td
                        className="border-y px-2 py-2 text-right tabular-nums"
                        style={{ borderColor: '#b8d4ea' }}
                      >
                        {formatPtMoney(row.valorTributavel)} €
                      </td>
                      <td
                        className="border-y px-2 py-2 text-right tabular-nums"
                        style={{ borderColor: '#b8d4ea' }}
                      >
                        {formatPtMoney(row.valorIva)} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AtSection>
        ) : null}

        <AtSection title="Observações" collapsible defaultOpen={false}>
          <Field label="Observações">
            <AtTextarea
              value={draft.observacoes}
              onChange={(e) => update('observacoes', e.target.value)}
            />
          </Field>
        </AtSection>

        {showIrs ? (
          <AtSection title="IRS">
            <Field label="Base de incidência em IRS">
              <AtSelect
                value={draft.baseIncidenciaIrs}
                onChange={(e) => {
                  const base = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    baseIncidenciaIrs: base,
                    retencaoFonteIrs: recibosVerdesNeedsRetencaoIrs(base)
                      ? prev.retencaoFonteIrs
                      : '',
                  }));
                }}
              >
                {RECIBOS_VERDES_BASES_IRS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </AtSelect>
            </Field>
            <Field label="Retenção na fonte IRS">
              {showRetencao ? (
                <AtSelect
                  value={draft.retencaoFonteIrs}
                  onChange={(e) => update('retencaoFonteIrs', e.target.value)}
                >
                  <option value="">— Seleccione —</option>
                  {RECIBOS_VERDES_TAXAS_RETENCAO_IRS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </AtSelect>
              ) : (
                <p className="text-[13px] text-[#555]">- - -</p>
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 text-[13px]">
              <div>
                <p className="font-bold text-[#333]">Rendimento Tributável</p>
                <p className="tabular-nums">{formatPtMoney(totals.rendimentoTributavel)} €</p>
              </div>
              <div>
                <p className="font-bold text-[#333]">Valor de IRS</p>
                <p className="tabular-nums">{formatPtMoney(totals.valorIrs)} €</p>
              </div>
            </div>
          </AtSection>
        ) : null}

        <AtSection title={`Totais da ${draft.tipoDocumento}`}>
          <div className="space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-6">
              <span className="font-bold text-[#333]">Data da transação</span>
              <span>{draft.dataPrestacao || '—'}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#555]">Valor ilíquido</span>
              <span className="tabular-nums">{formatPtMoney(totals.valorIliquido)} €</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#555]">IVA</span>
              <span className="tabular-nums">{formatPtMoney(totals.valorIva)} €</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#555]">Imposto do Selo</span>
              <span className="tabular-nums">{formatPtMoney(totals.impostoSelo)} €</span>
            </div>
            <div className="flex justify-between gap-6 font-bold">
              <span>TOTAL DO DOCUMENTO</span>
              <span className="tabular-nums">{formatPtMoney(totals.totalDocumento)} €</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#555]">Retenção na fonte IRS</span>
              <span className="tabular-nums">{formatPtMoney(totals.retencaoIrs)} €</span>
            </div>
            <div
              className="flex justify-between gap-6 border-t pt-1.5 font-bold"
              style={{ borderColor: AT_BORDER }}
            >
              <span>TOTAL A PAGAR</span>
              <span className="tabular-nums">{formatPtMoney(totals.totalPagar)} €</span>
            </div>
          </div>
        </AtSection>

        <AtSection title="Pré-visualização resultado (como na AT)" collapsible defaultOpen>
          <div className="space-y-3 text-[13px] text-[#333]">
            <div>
              <p className="font-bold" style={{ color: AT_BLUE }}>
                RASCUNHO · Emitido (local)
              </p>
              <p className="text-[16px] font-bold">{draft.tipoDocumento}</p>
              <p>Emitida a — (na AT)</p>
              <p>ATCUD: — (na AT)</p>
              <p>Via de Emissão: Portal</p>
              <p>Sem Documentos associados.</p>
            </div>
            <div>
              <p className="font-bold" style={{ color: AT_BLUE }}>
                Transmitente
              </p>
              <p className="text-[#666]">
                Conta autenticada no Portal das Finanças (login) — não se edita no rascunho.
              </p>
            </div>
            <div>
              <p className="font-bold" style={{ color: AT_BLUE }}>
                Adquirente
              </p>
              <p>
                <span className="font-bold">País</span> {draft.adquirentePais.toUpperCase() || '—'}
              </p>
              <p>
                <span className="font-bold">NIF</span> {draft.adquirenteNif || '—'}
              </p>
              <p>
                <span className="font-bold">Nome</span> {draft.adquirenteNome || '—'}
              </p>
              <p className="mt-1 font-bold">Morada de Cliente</p>
              <p>
                <span className="font-bold">Morada</span> {draft.adquirenteMorada || '—'}
              </p>
              <p>
                <span className="font-bold">Código Postal</span>{' '}
                {draft.adquirenteCodigoPostal || '—'}
              </p>
              <p>
                <span className="font-bold">Localidade</span> {draft.adquirenteLocalidade || '—'}
              </p>
              <p>
                <span className="font-bold">País</span> {draft.adquirentePais.toUpperCase() || '—'}
              </p>
            </div>
            <div>
              <p className="font-bold" style={{ color: AT_BLUE }}>
                Motivo de Emissão
              </p>
              <p>
                <span className="font-bold">Documento emitido a título de:</span>{' '}
                {draft.motivoEmissao}
              </p>
            </div>
            <div>
              <p className="font-bold" style={{ color: AT_BLUE }}>
                Produtos, Serviços ou Outros
              </p>
              {draft.linhas.map((linha) => {
                const fmt = formatLinhaReferenciaDescricaoAt(linha);
                return (
                  <div key={linha.id} className="mb-2 border-b pb-2" style={{ borderColor: '#eee' }}>
                    <p>{fmt.linha1}</p>
                    <p>{fmt.linha2}</p>
                    <p>{fmt.linha3}</p>
                    <p>
                      {formatPtMoney(parseIvaPercent(linha.taxaIva))}%
                      {parseIvaPercent(linha.taxaIva) === 0 ? ' a)' : ''} ·{' '}
                      {formatPtMoney(lineTotalComImposto(linha))} €
                    </p>
                  </div>
                );
              })}
            </div>
            <div>
              <p className="font-bold" style={{ color: AT_BLUE }}>
                Taxas de IVA
              </p>
              {totals.porTaxa.map((row) => (
                <p key={`${row.taxa}|${row.motivo}`}>
                  {row.taxa}
                  {row.motivo ? ` - a) ${row.motivo}` : ''} · Tributável{' '}
                  {formatPtMoney(row.valorTributavel)} € · IVA {formatPtMoney(row.valorIva)} €
                </p>
              ))}
            </div>
            {showIrs ? (
              <div>
                <p className="font-bold" style={{ color: AT_BLUE }}>
                  IRS
                </p>
                <p>
                  <span className="font-bold">Base de incidência em IRS</span>{' '}
                  {draft.baseIncidenciaIrs}
                </p>
                <p>
                  <span className="font-bold">Retenção na fonte IRS</span>{' '}
                  {draft.retencaoFonteIrs || '- - -'}
                </p>
                <p>
                  <span className="font-bold">Rendimento Tributável</span>{' '}
                  {formatPtMoney(totals.rendimentoTributavel)} €
                </p>
                <p>
                  <span className="font-bold">Valor de IRS</span> {formatPtMoney(totals.valorIrs)} €
                </p>
              </div>
            ) : null}
            <div>
              <p className="font-bold" style={{ color: AT_BLUE }}>
                Totais da {draft.tipoDocumento}
              </p>
              <p>
                <span className="font-bold">Data da transação</span> {draft.dataPrestacao || '—'}
              </p>
              <p>
                Valor ilíquido:{formatPtMoney(totals.valorIliquido)} € · IVA:
                {formatPtMoney(totals.valorIva)} € · Imposto do Selo:
                {formatPtMoney(totals.impostoSelo)} € · TOTAL DO DOCUMENTO:
                {formatPtMoney(totals.totalDocumento)} € · Retenção na fonte IRS:
                {formatPtMoney(totals.retencaoIrs)} € · TOTAL A PAGAR:
                {formatPtMoney(totals.totalPagar)} €
              </p>
            </div>
          </div>
        </AtSection>

        <div
          className="flex flex-wrap justify-end gap-2 border-t pt-3"
          style={{ borderColor: AT_BORDER }}
        >
          <button
            type="button"
            disabled={busy}
            className="rounded-[3px] px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-white disabled:opacity-60"
            style={{ backgroundColor: AT_BLUE }}
            onClick={() => void emitirPdf()}
          >
            {busy ? 'A gerar…' : 'Emitir PDF'}
          </button>
        </div>
      </div>

      {modalLinha ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div
            className="my-6 w-full max-w-2xl overflow-hidden border bg-white shadow-xl"
            style={{ borderColor: AT_BORDER }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5 text-[15px] font-bold text-white"
              style={{ backgroundColor: AT_BLUE }}
            >
              <span>Adicionar Produto, Serviço ou Outros</span>
              <button
                type="button"
                className="text-white/90 hover:text-white"
                onClick={() => setModalLinha(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 p-4">
              {catalog.length > 0 ? (
                <Field label="Usar referência local guardada">
                  <AtSelect
                    defaultValue=""
                    onChange={(e) => {
                      const item = catalog.find((c) => c.id === e.target.value);
                      if (item) applyCatalogItem(item);
                    }}
                  >
                    <option value="">— Seleccionar —</option>
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {[c.referencia, c.descricao].filter(Boolean).join(' — ') || c.descricao}
                      </option>
                    ))}
                  </AtSelect>
                </Field>
              ) : null}

              <div>
                <p className="mb-2 text-[15px] font-bold text-[#333]">Dados de Identificação</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Tipo">
                    <AtSelect
                      value={modalLinha.tipo}
                      onChange={(e) =>
                        setModalLinha({
                          ...modalLinha,
                          tipo: e.target.value as RecibosVerdesDraftLinha['tipo'],
                        })
                      }
                    >
                      {RECIBOS_VERDES_LINHA_TIPOS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </AtSelect>
                  </Field>
                  <Field label="Tipo Ref." hint>
                    <AtSelect
                      value={modalLinha.tipoRef}
                      onChange={(e) =>
                        setModalLinha({
                          ...modalLinha,
                          tipoRef: e.target.value as RecibosVerdesDraftLinha['tipoRef'],
                        })
                      }
                    >
                      {RECIBOS_VERDES_TIPO_REF.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </AtSelect>
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Referência" hint>
                    <AtInput
                      value={modalLinha.referencia}
                      onChange={(e) =>
                        setModalLinha({ ...modalLinha, referencia: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Descrição" hint>
                    <AtTextarea
                      value={modalLinha.descricao}
                      onChange={(e) =>
                        setModalLinha({ ...modalLinha, descricao: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[15px] font-bold text-[#333]">Valores</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Quantidade">
                    <AtInput
                      value={modalLinha.quantidade}
                      onChange={(e) =>
                        setModalLinha({ ...modalLinha, quantidade: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Unidade">
                    <AtSelect
                      value={modalLinha.unidade}
                      onChange={(e) => setModalLinha({ ...modalLinha, unidade: e.target.value })}
                    >
                      <option value="Unidade">Unidade</option>
                      <option value="Hora">Hora</option>
                      <option value="Dia">Dia</option>
                      <option value="Serviço">Serviço</option>
                      <option value="N/A - Não Aplicável">N/A - Não Aplicável</option>
                    </AtSelect>
                  </Field>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Preço Unitário s/IVA">
                    <SuffixField suffix="€">
                      <AtInput
                        value={modalLinha.precoUnitarioSemIva}
                        onChange={(e) =>
                          setModalLinha({ ...modalLinha, precoUnitarioSemIva: e.target.value })
                        }
                      />
                    </SuffixField>
                  </Field>
                  <Field label="Taxa de Desconto Comercial">
                    <SuffixField suffix="%">
                      <AtInput
                        value={modalLinha.taxaDesconto}
                        onChange={(e) =>
                          setModalLinha({ ...modalLinha, taxaDesconto: e.target.value })
                        }
                      />
                    </SuffixField>
                  </Field>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Valor a Descontar">
                    <SuffixField suffix="€">
                      <AtInput
                        value={modalLinha.desconto}
                        onChange={(e) =>
                          setModalLinha({ ...modalLinha, desconto: e.target.value })
                        }
                      />
                    </SuffixField>
                  </Field>
                  <Field label="Taxa IVA">
                    <AtSelect
                      value={modalLinha.taxaIva}
                      onChange={(e) => setModalLinha({ ...modalLinha, taxaIva: e.target.value })}
                    >
                      {RECIBOS_VERDES_TAXAS_IVA.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </AtSelect>
                  </Field>
                </div>
                {modalLinha.taxaIva.startsWith('0') ? (
                  <div className="mt-3">
                    <Field label="Motivo de Isenção">
                      <AtSelect
                        value={modalLinha.motivoIsencao}
                        onChange={(e) =>
                          setModalLinha({ ...modalLinha, motivoIsencao: e.target.value })
                        }
                      >
                        {RECIBOS_VERDES_MOTIVOS_ISENCAO.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </AtSelect>
                    </Field>
                  </div>
                ) : null}
                <div className="mt-3">
                  <Field label="Verbas de Imposto do Selo">
                    <AtSelect
                      value={modalLinha.verbaImpostoSelo}
                      onChange={(e) =>
                        setModalLinha({ ...modalLinha, verbaImpostoSelo: e.target.value })
                      }
                    >
                      {RECIBOS_VERDES_IMPOSTO_SELO.map((t) => (
                        <option key={t || 'none'} value={t}>
                          {t || '— Nenhum —'}
                        </option>
                      ))}
                    </AtSelect>
                  </Field>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[13px] text-[#333]">
                <input
                  type="checkbox"
                  checked={saveToCatalog}
                  onChange={(e) => setSaveToCatalog(e.target.checked)}
                />
                Guardar como referência local (catálogo de produtos/serviços)
              </label>

              <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: AT_BORDER }}>
                {editingId ? (
                  <button
                    type="button"
                    className="mr-auto text-[12px] font-semibold uppercase text-red-600"
                    onClick={() => {
                      setDraft((prev) => ({
                        ...prev,
                        linhas: prev.linhas.filter((l) => l.id !== editingId),
                      }));
                      setModalLinha(null);
                    }}
                  >
                    Remover linha
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-[3px] border bg-white px-4 py-1.5 text-[13px] font-semibold uppercase text-[#444]"
                  style={{ borderColor: AT_BORDER }}
                  onClick={() => setModalLinha(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="rounded-[3px] px-4 py-1.5 text-[13px] font-semibold uppercase text-white"
                  style={{ backgroundColor: AT_BLUE }}
                  onClick={guardarLinha}
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import {
  useMemo,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import {
  RECIBOS_VERDES_DOCUMENTO_TIPOS,
  RECIBOS_VERDES_LINHA_TIPOS,
  RECIBOS_VERDES_MOTIVOS_ISENCAO,
  RECIBOS_VERDES_TAXAS_IVA,
  RECIBOS_VERDES_TIPO_REF,
  createRecibosVerdesDraftExample,
  formatPtMoney,
  summarizeRecibosVerdesDraft,
  type RecibosVerdesDraft,
  type RecibosVerdesDraftLinha,
} from '@tvde/shared';
import { downloadRecibosVerdesDraftPdf } from '@/lib/recibos-verdes-draft-pdf';

/** Azul AT (Portal das Finanças — barras de secção / EMITIR). */
const AT_BLUE = '#0073bb';
const AT_BORDER = '#d0d0d0';

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

function SuffixField({
  suffix,
  children,
}: {
  suffix: string;
  children: ReactNode;
}) {
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
          <ChevronDown
            size={16}
            className={`transition ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        ) : null}
      </button>
      {open ? <div className="space-y-3 p-4">{children}</div> : null}
    </section>
  );
}

function emptyLinha(): RecibosVerdesDraftLinha {
  return {
    ...createRecibosVerdesDraftExample().linhas[0],
    descricao: '',
    precoUnitarioSemIva: '',
    referencia: '',
    taxaDesconto: '',
    desconto: '',
  };
}

export function AdminMgmtRecibosVerdesDraft() {
  const [draft, setDraft] = useState<RecibosVerdesDraft>(() => createRecibosVerdesDraftExample());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const totals = useMemo(() => summarizeRecibosVerdesDraft(draft), [draft]);

  function update<K extends keyof RecibosVerdesDraft>(key: K, value: RecibosVerdesDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateLinha(index: number, patch: Partial<RecibosVerdesDraftLinha>) {
    setDraft((prev) => ({
      ...prev,
      linhas: prev.linhas.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));
  }

  async function gerarPdf() {
    setBusy(true);
    setError('');
    try {
      await downloadRecibosVerdesDraftPdf(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar PDF');
    } finally {
      setBusy(false);
    }
  }

  function resetExample() {
    setDraft(createRecibosVerdesDraftExample());
    setError('');
  }

  return (
    <div
      className="overflow-hidden border bg-[#f7f7f7] font-sans"
      style={{ borderColor: AT_BORDER }}
    >
      <div className="border-b bg-[#fff8e6] px-4 py-2 text-[12px] text-[#7a5c00]" style={{ borderColor: '#f0e0a8' }}>
        Rascunho local — não emite no Portal das Finanças. Visual alinhado ao formulário AT para
        validar campos antes do RPA.
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
              onClick={resetExample}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-[3px] px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-white disabled:opacity-60"
              style={{ backgroundColor: AT_BLUE }}
              onClick={() => void gerarPdf()}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data emissão (PDF)">
              <AtInput
                type="date"
                value={draft.dataEmissao}
                onChange={(e) => update('dataEmissao', e.target.value)}
              />
            </Field>
            <Field label="N.º documento (visual)">
              <AtInput
                value={draft.numeroDocumento}
                onChange={(e) => update('numeroDocumento', e.target.value)}
              />
            </Field>
          </div>
        </AtSection>

        <AtSection title="Transmitente">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="NIF">
              <AtInput
                value={draft.transmitenteNif}
                onChange={(e) => update('transmitenteNif', e.target.value)}
              />
            </Field>
            <Field label="Nome">
              <AtInput
                value={draft.transmitenteNome}
                onChange={(e) => update('transmitenteNome', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Domicílio fiscal / Estabelecimento estável">
            <AtInput
              value={draft.transmitenteMorada}
              onChange={(e) => update('transmitenteMorada', e.target.value)}
            />
          </Field>
          <Field label="Atividade exercida">
            <AtInput
              value={draft.transmitenteAtividade}
              onChange={(e) => update('transmitenteAtividade', e.target.value)}
              placeholder="Actividade CAE / descrição"
            />
          </Field>
        </AtSection>

        <AtSection title="Adquirente">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
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
                onChange={(e) => update('adquirenteNif', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Nome">
            <AtInput
              value={draft.adquirenteNome}
              onChange={(e) => update('adquirenteNome', e.target.value)}
            />
          </Field>
          <Field label="Sede ou domicílio">
            <AtInput
              value={draft.adquirenteMorada}
              onChange={(e) => update('adquirenteMorada', e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-[3px] border bg-white px-4 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#444]"
              style={{ borderColor: AT_BORDER }}
              title="Só visual — no RPA fará a procura na AT"
            >
              Procurar
            </button>
          </div>
        </AtSection>

        <AtSection title="Motivo de Emissão">
          <Field label="Documento emitido a título de">
            <AtSelect
              value={draft.motivoEmissao}
              onChange={(e) => update('motivoEmissao', e.target.value)}
            >
              <option value="Pagamento dos bens ou dos serviços">
                Pagamento dos bens ou dos serviços
              </option>
              <option value="Adiantamento">Adiantamento</option>
              <option value="Outro">Outro</option>
            </AtSelect>
          </Field>
        </AtSection>

        <AtSection title="Produtos e Serviços">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-[#666]">
              Linhas do documento — layout do modal «Adicionar Produto, Serviço ou Outros».
            </p>
            <button
              type="button"
              className="rounded-[3px] border bg-white px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#444]"
              style={{ borderColor: AT_BORDER }}
              onClick={() => {
                setDraft((prev) => ({ ...prev, linhas: [...prev.linhas, emptyLinha()] }));
              }}
            >
              Adicionar
            </button>
          </div>

          {draft.linhas.map((linha, index) => (
            <div
              key={index}
              className="overflow-hidden border"
              style={{ borderColor: AT_BORDER }}
            >
              <div
                className="flex items-center justify-between px-3 py-2 text-[13px] font-bold text-white"
                style={{ backgroundColor: AT_BLUE }}
              >
                <span>Adicionar Produto, Serviço ou Outros — linha {index + 1}</span>
                {draft.linhas.length > 1 ? (
                  <button
                    type="button"
                    className="text-[12px] font-semibold uppercase text-white/90 hover:text-white"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        linhas: prev.linhas.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Remover
                  </button>
                ) : null}
              </div>
              <div className="space-y-4 bg-white p-4">
                <div>
                  <p className="mb-2 text-[15px] font-bold text-[#333]">Dados de Identificação</p>
                  <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
                    <Field label="Tipo">
                      <AtSelect
                        value={linha.tipo}
                        onChange={(e) =>
                          updateLinha(index, {
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
                        value={linha.tipoRef}
                        onChange={(e) =>
                          updateLinha(index, {
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
                        value={linha.referencia}
                        onChange={(e) => updateLinha(index, { referencia: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Descrição" hint>
                      <AtTextarea
                        value={linha.descricao}
                        onChange={(e) => updateLinha(index, { descricao: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[15px] font-bold text-[#333]">Valores</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Quantidade">
                      <AtInput
                        value={linha.quantidade}
                        onChange={(e) => updateLinha(index, { quantidade: e.target.value })}
                      />
                    </Field>
                    <Field label="Unidade">
                      <AtSelect
                        value={linha.unidade}
                        onChange={(e) => updateLinha(index, { unidade: e.target.value })}
                      >
                        <option value="Unidade">Unidade</option>
                        <option value="Hora">Hora</option>
                        <option value="Dia">Dia</option>
                        <option value="Serviço">Serviço</option>
                      </AtSelect>
                    </Field>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Preço Unitário s/IVA">
                      <SuffixField suffix="€">
                        <AtInput
                          value={linha.precoUnitarioSemIva}
                          onChange={(e) =>
                            updateLinha(index, { precoUnitarioSemIva: e.target.value })
                          }
                          placeholder="390,64"
                        />
                      </SuffixField>
                    </Field>
                    <Field label="Taxa de Desconto Comercial">
                      <SuffixField suffix="%">
                        <AtInput
                          value={linha.taxaDesconto}
                          onChange={(e) => updateLinha(index, { taxaDesconto: e.target.value })}
                        />
                      </SuffixField>
                    </Field>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Valor a Descontar">
                      <SuffixField suffix="€">
                        <AtInput
                          value={linha.desconto}
                          onChange={(e) => updateLinha(index, { desconto: e.target.value })}
                        />
                      </SuffixField>
                    </Field>
                    <Field label="Taxa IVA">
                      <AtSelect
                        value={linha.taxaIva}
                        onChange={(e) => updateLinha(index, { taxaIva: e.target.value })}
                      >
                        {RECIBOS_VERDES_TAXAS_IVA.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {!RECIBOS_VERDES_TAXAS_IVA.includes(
                          linha.taxaIva as (typeof RECIBOS_VERDES_TAXAS_IVA)[number]
                        ) ? (
                          <option value={linha.taxaIva}>{linha.taxaIva}</option>
                        ) : null}
                      </AtSelect>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Motivo de Isenção">
                      <AtSelect
                        value={linha.motivoIsencao}
                        onChange={(e) => updateLinha(index, { motivoIsencao: e.target.value })}
                        disabled={!linha.taxaIva.startsWith('0')}
                      >
                        {RECIBOS_VERDES_MOTIVOS_ISENCAO.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {!RECIBOS_VERDES_MOTIVOS_ISENCAO.includes(
                          linha.motivoIsencao as (typeof RECIBOS_VERDES_MOTIVOS_ISENCAO)[number]
                        ) ? (
                          <option value={linha.motivoIsencao}>{linha.motivoIsencao}</option>
                        ) : null}
                      </AtSelect>
                    </Field>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </AtSection>

        <AtSection title="Observações" collapsible defaultOpen={false}>
          <Field label="Observações">
            <AtTextarea
              value={draft.observacoes}
              onChange={(e) => update('observacoes', e.target.value)}
            />
          </Field>
        </AtSection>

        <AtSection title="Totais do Documento">
          <Field label="Base de incidência IRS">
            <AtInput
              value={draft.baseIncidenciaIrs}
              onChange={(e) => update('baseIncidenciaIrs', e.target.value)}
            />
          </Field>
          <div className="ml-auto max-w-xs space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-6">
              <span className="text-[#555]">Valor ilíquido</span>
              <span className="tabular-nums font-semibold">{formatPtMoney(totals.valorIliquido)} €</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#555]">IVA</span>
              <span className="tabular-nums font-semibold">{formatPtMoney(totals.valorIva)} €</span>
            </div>
            <div className="flex justify-between gap-6 border-t pt-1.5 font-bold" style={{ borderColor: AT_BORDER }}>
              <span>Total a pagar</span>
              <span className="tabular-nums">{formatPtMoney(totals.totalDocumento)} €</span>
            </div>
          </div>
        </AtSection>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3" style={{ borderColor: AT_BORDER }}>
          <button
            type="button"
            className="rounded-[3px] border bg-white px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-[#444]"
            style={{ borderColor: AT_BORDER }}
            onClick={resetExample}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-[3px] px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-white disabled:opacity-60"
            style={{ backgroundColor: AT_BLUE }}
            onClick={() => void gerarPdf()}
          >
            {busy ? 'A gerar…' : 'Emitir PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

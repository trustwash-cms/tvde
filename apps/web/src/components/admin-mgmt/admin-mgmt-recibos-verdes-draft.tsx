'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { FileDown, RotateCcw } from 'lucide-react';
import {
  RECIBOS_VERDES_DOCUMENTO_TIPOS,
  RECIBOS_VERDES_LINHA_TIPOS,
  RECIBOS_VERDES_TIPO_REF,
  createRecibosVerdesDraftExample,
  formatPtMoney,
  summarizeRecibosVerdesDraft,
  type RecibosVerdesDraft,
  type RecibosVerdesDraftLinha,
} from '@tvde/shared';
import { downloadRecibosVerdesDraftPdf } from '@/lib/recibos-verdes-draft-pdf';

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function emptyLinha(): RecibosVerdesDraftLinha {
  return {
    ...createRecibosVerdesDraftExample().linhas[0],
    descricao: '',
    precoUnitarioSemIva: '',
    referencia: '',
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

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Rascunho Fatura-Recibo (local)</h3>
          <p className="mt-0.5 text-xs text-slate-600 max-w-2xl">
            Não emite nada na AT. Preencha os campos como no Portal das Finanças e gere um PDF à
            semelhança da fatura real para alinhar textos, IVA Art.53.º e totais. Quando estiver
            certo, o RPA usa os mesmos valores.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            onClick={() => {
              setDraft(createRecibosVerdesDraftExample());
              setError('');
            }}
          >
            <RotateCcw size={14} />
            Exemplo fatura 24
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5 text-sm"
            disabled={busy}
            onClick={() => void gerarPdf()}
          >
            <FileDown size={14} />
            {busy ? 'A gerar…' : 'Gerar PDF rascunho'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tipo de documento">
          <select
            className="input"
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
          </select>
        </Field>
        <Field label="N.º documento (visual)">
          <input
            className="input font-mono text-sm"
            value={draft.numeroDocumento}
            onChange={(e) => update('numeroDocumento', e.target.value)}
          />
        </Field>
        <Field label="Data emissão">
          <input
            className="input"
            type="date"
            value={draft.dataEmissao}
            onChange={(e) => update('dataEmissao', e.target.value)}
          />
        </Field>
        <Field label="Data prestação / transação">
          <input
            className="input"
            type="date"
            value={draft.dataPrestacao}
            onChange={(e) => update('dataPrestacao', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Motivo de emissão">
        <input
          className="input"
          value={draft.motivoEmissao}
          onChange={(e) => update('motivoEmissao', e.target.value)}
        />
      </Field>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-white bg-white/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Transmitente
          </p>
          <Field label="Nome">
            <input
              className="input"
              value={draft.transmitenteNome}
              onChange={(e) => update('transmitenteNome', e.target.value)}
            />
          </Field>
          <Field label="NIF">
            <input
              className="input font-mono"
              value={draft.transmitenteNif}
              onChange={(e) => update('transmitenteNif', e.target.value)}
            />
          </Field>
          <Field label="Morada">
            <input
              className="input"
              value={draft.transmitenteMorada}
              onChange={(e) => update('transmitenteMorada', e.target.value)}
            />
          </Field>
        </div>
        <div className="space-y-2 rounded-lg border border-white bg-white/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Adquirente
          </p>
          <Field label="Nome">
            <input
              className="input"
              value={draft.adquirenteNome}
              onChange={(e) => update('adquirenteNome', e.target.value)}
            />
          </Field>
          <Field label="NIF">
            <input
              className="input font-mono"
              value={draft.adquirenteNif}
              onChange={(e) => update('adquirenteNif', e.target.value)}
            />
          </Field>
          <Field label="Morada">
            <input
              className="input"
              value={draft.adquirenteMorada}
              onChange={(e) => update('adquirenteMorada', e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Produtos / serviços
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
            onClick={() => setDraft((prev) => ({ ...prev, linhas: [...prev.linhas, emptyLinha()] }))}
          >
            + Adicionar linha
          </button>
        </div>

        {draft.linhas.map((linha, index) => (
          <div
            key={index}
            className="space-y-2 rounded-lg border border-white bg-white/80 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Linha {index + 1}</span>
              {draft.linhas.length > 1 ? (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
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
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tipo">
                <select
                  className="input"
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
                </select>
              </Field>
              <Field label="Tipo Ref.">
                <select
                  className="input"
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
                </select>
              </Field>
              <Field label="Referência">
                <input
                  className="input"
                  value={linha.referencia}
                  onChange={(e) => updateLinha(index, { referencia: e.target.value })}
                />
              </Field>
              <Field label="Unidade">
                <input
                  className="input"
                  value={linha.unidade}
                  onChange={(e) => updateLinha(index, { unidade: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Descrição">
              <input
                className="input"
                value={linha.descricao}
                onChange={(e) => updateLinha(index, { descricao: e.target.value })}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Quantidade">
                <input
                  className="input"
                  value={linha.quantidade}
                  onChange={(e) => updateLinha(index, { quantidade: e.target.value })}
                />
              </Field>
              <Field label="Preço s/IVA">
                <input
                  className="input tabular-nums"
                  value={linha.precoUnitarioSemIva}
                  onChange={(e) => updateLinha(index, { precoUnitarioSemIva: e.target.value })}
                  placeholder="390,64"
                />
              </Field>
              <Field label="Taxa IVA">
                <input
                  className="input"
                  value={linha.taxaIva}
                  onChange={(e) => updateLinha(index, { taxaIva: e.target.value })}
                  placeholder="0%"
                />
              </Field>
              <Field label="Desconto">
                <input
                  className="input"
                  value={linha.desconto}
                  onChange={(e) => updateLinha(index, { desconto: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Motivo de isenção IVA">
              <input
                className="input text-sm"
                value={linha.motivoIsencao}
                onChange={(e) => updateLinha(index, { motivoIsencao: e.target.value })}
              />
            </Field>
          </div>
        ))}
      </div>

      <Field label="Base incidência IRS">
        <input
          className="input"
          value={draft.baseIncidenciaIrs}
          onChange={(e) => update('baseIncidenciaIrs', e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm">
        <span className="text-slate-600">Totais do rascunho</span>
        <div className="flex flex-wrap gap-4 tabular-nums text-slate-900">
          <span>Ilíquido {formatPtMoney(totals.valorIliquido)} €</span>
          <span>IVA {formatPtMoney(totals.valorIva)} €</span>
          <span className="font-semibold">Total {formatPtMoney(totals.totalDocumento)} €</span>
        </div>
      </div>
    </div>
  );
}

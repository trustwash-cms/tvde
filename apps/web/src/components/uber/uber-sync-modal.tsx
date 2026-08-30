'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  defaultUberReportRange,
  guessUberOrganizationsFromReports,
  guessUberReportTypesFromReports,
  isoToLisbonDatetimeLocal,
  lisbonDatetimeLocalToIso,
  resolveUberReportType,
  uberReportMatchesType,
  uberReportTypeLabel,
  UBER_REPORT_TYPE_CATALOG,
  DEFAULT_UBER_REPORT_TYPE,
  type UberReportListItem,
  type UberReportTypeKey,
  type UberSyncOptions,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';

const ORG_STORAGE_KEY = 'tvde.uber.organizationName';
const REPORT_TYPE_STORAGE_KEY = 'tvde.uber.reportTypeKey';
const DEFAULT_ORG = 'CAMINHOS TOLERANTES, LDA';

type Props = {
  open: boolean;
  onClose: () => void;
  onSync: (uberSync: UberSyncOptions) => void | Promise<void>;
  busy?: boolean;
};

function readStoredOrg(): string {
  if (typeof window === 'undefined') return DEFAULT_ORG;
  try {
    return localStorage.getItem(ORG_STORAGE_KEY)?.trim() || DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG;
  }
}

function readStoredReportType(): UberReportTypeKey {
  if (typeof window === 'undefined') return DEFAULT_UBER_REPORT_TYPE;
  try {
    return resolveUberReportType(localStorage.getItem(REPORT_TYPE_STORAGE_KEY));
  } catch {
    return DEFAULT_UBER_REPORT_TYPE;
  }
}

export function UberSyncModal({ open, onClose, onSync, busy }: Props) {
  const defaults = defaultUberReportRange();
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState('');
  const [reports, setReports] = useState<UberReportListItem[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState(DEFAULT_ORG);
  const [reportTypeKey, setReportTypeKey] = useState<UberReportTypeKey>(DEFAULT_UBER_REPORT_TYPE);
  const [rangeStartLocal, setRangeStartLocal] = useState(() =>
    isoToLisbonDatetimeLocal(defaults.rangeStart)
  );
  const [rangeEndLocal, setRangeEndLocal] = useState(() =>
    isoToLisbonDatetimeLocal(defaults.rangeEnd)
  );
  const [actionError, setActionError] = useState('');

  const orgSuggestions = useMemo(
    () => guessUberOrganizationsFromReports(reports.map((r) => r.name)),
    [reports]
  );

  useEffect(() => {
    if (!open) return;
    const range = defaultUberReportRange();
    setRangeStartLocal(isoToLisbonDatetimeLocal(range.rangeStart));
    setRangeEndLocal(isoToLisbonDatetimeLocal(range.rangeEnd));
    setSelectedName(null);
    setOrganizationName(readStoredOrg());
    setReportTypeKey(readStoredReportType());
    setActionError('');
    setListError('');
    setLoadingList(true);
    void (async () => {
      const res = await apiFetch<UberReportListItem[]>(
        API_PATHS.portalConnections.reports('uber'),
        { method: 'POST', body: JSON.stringify({}) },
        getStoredToken()
      );
      setLoadingList(false);
      if (!res.success || !res.data) {
        setReports([]);
        setListError(res.error || 'Não foi possível listar relatórios');
        return;
      }
      setReports(res.data);
      const storedType = readStoredReportType();
      const paymentReports = res.data.filter(
        (r) => r.hasDownload && uberReportMatchesType(r, storedType)
      );
      const firstDownloadable =
        paymentReports.find((r) => r.hasDownload)?.name ??
        res.data.find((r) => r.hasDownload && /payments_order/i.test(r.name))?.name ??
        res.data.find((r) => r.hasDownload && !/driver_activity/i.test(r.name))?.name ??
        null;
      if (firstDownloadable) setSelectedName(firstDownloadable);

      const guessed = guessUberOrganizationsFromReports(res.data.map((r) => r.name));
      const stored = readStoredOrg();
      if (stored && stored !== DEFAULT_ORG) {
        setOrganizationName(stored);
      } else if (guessed[0]) {
        setOrganizationName(guessed[0]);
      }
      const typeFromList = guessUberReportTypesFromReports(res.data);
      if (typeFromList.includes(storedType)) {
        setReportTypeKey(storedType);
      } else if (typeFromList[0]) {
        setReportTypeKey(typeFromList[0]);
      }
    })();
  }, [open]);

  async function handleDownloadSelected() {
    if (!selectedName) {
      setActionError('Seleccione um relatório na lista');
      return;
    }
    setActionError('');
    await onSync({ mode: 'existing', reportName: selectedName });
  }

  async function handleGenerate() {
    const org = organizationName.trim();
    if (!org) {
      setActionError('Indique a organização (obrigatório para Gerar)');
      return;
    }
    try {
      const rangeStart = lisbonDatetimeLocalToIso(rangeStartLocal);
      const rangeEnd = lisbonDatetimeLocalToIso(rangeEndLocal);
      if (new Date(rangeEnd).getTime() <= new Date(rangeStart).getTime()) {
        setActionError('A data/hora de fim deve ser depois do início');
        return;
      }
      try {
        localStorage.setItem(ORG_STORAGE_KEY, org);
        localStorage.setItem(REPORT_TYPE_STORAGE_KEY, reportTypeKey);
      } catch {
        /* ignore */
      }
      setActionError('');
      await onSync({
        mode: 'generate',
        rangeStart,
        rangeEnd,
        organizationName: org,
        reportTypeKey,
      });
    } catch {
      setActionError('Datas inválidas');
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy || loadingList) return;
        onClose();
      }}
      title="Sincronizar Uber"
      showCloseButton={!busy && !loadingList}
      closeOnBackdrop={!busy && !loadingList}
      closeOnEscape={!busy && !loadingList}
      scrollBody
      panelClassName="max-w-2xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={busy || loadingList}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary text-sm inline-flex items-center gap-2"
            disabled={busy || loadingList || !selectedName}
            onClick={() => void handleDownloadSelected()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Descarregar seleccionado
          </button>
        </div>
      }
    >
      <div className="space-y-5 p-1">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">Relatórios existentes</h3>
          <p className="text-xs text-slate-500">
            Lista do Supplier (Relatórios). Escolha um e descarregue, ou gere um novo abaixo.
          </p>
          {loadingList ? (
            <div className="flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              <Loader2 size={16} className="animate-spin text-sky-600" />
              A listar relatórios no portal… (pode demorar ~45–60s)
            </div>
          ) : listError ? (
            <p className="text-sm text-amber-700">{listError}</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum relatório encontrado na lista.</p>
          ) : (
            <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2 font-medium">Nome</th>
                    <th className="px-2 py-2 font-medium">Intervalo</th>
                    <th className="px-2 py-2 font-medium">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const disabled = !r.hasDownload;
                    return (
                      <tr
                        key={r.name + (r.createdAt ?? '')}
                        className={`border-t border-slate-100 ${disabled ? 'opacity-50' : 'hover:bg-slate-50'}`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="radio"
                            name="uber-report"
                            disabled={disabled || busy}
                            checked={selectedName === r.name}
                            onChange={() => setSelectedName(r.name)}
                          />
                        </td>
                        <td
                          className="max-w-[14rem] truncate px-2 py-1.5 font-medium text-slate-800"
                          title={r.name}
                        >
                          {r.name}
                        </td>
                        <td
                          className="max-w-[10rem] truncate px-2 py-1.5 text-slate-600"
                          title={r.interval ?? ''}
                        >
                          {r.interval ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                          {r.createdAt ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">Gerar novo</h3>
          <p className="text-xs text-slate-500">
            Intervalo personalizado (Europe/Lisbon). Default: semana completa anterior (segunda
            01:00 → domingo 23:30). A organização é obrigatória no portal Uber (activa o botão
            Gerar).
          </p>
          <label className="block text-xs text-slate-600">
            Tipo de relatório
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={reportTypeKey}
              disabled={busy}
              onChange={(e) => setReportTypeKey(resolveUberReportType(e.target.value))}
            >
              {UBER_REPORT_TYPE_CATALOG.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Organização
            <input
              type="text"
              list="uber-org-suggestions"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={organizationName}
              disabled={busy}
              placeholder="ex. CAMINHOS TOLERANTES, LDA"
              onChange={(e) => setOrganizationName(e.target.value)}
            />
            <datalist id="uber-org-suggestions">
              {orgSuggestions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-600">
              Início
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                value={rangeStartLocal}
                disabled={busy}
                onChange={(e) => setRangeStartLocal(e.target.value)}
              />
            </label>
            <label className="block text-xs text-slate-600">
              Fim
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                value={rangeEndLocal}
                disabled={busy}
                onChange={(e) => setRangeEndLocal(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            disabled={busy || loadingList || !organizationName.trim()}
            onClick={() => void handleGenerate()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Gerar e sincronizar
          </button>
        </section>

        {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
      </div>
    </Modal>
  );
}

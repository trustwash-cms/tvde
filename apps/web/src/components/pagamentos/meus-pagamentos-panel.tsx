'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Eye, Loader2, X } from 'lucide-react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';

function formatMoney(value: string | number) {
  const n = Number(value);
  if (Number.isNaN(n)) return '€ 0,00';
  return `€ ${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDatePt(ymd: string) {
  if (!ymd) return '—';
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-PT');
}

type PaymentReportRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  receitasTotal: string;
  despesasTotal: string;
  resultadoFinal: string;
  isPaid: boolean;
  paymentMethod: string | null;
};

type ReportsList = {
  items: PaymentReportRow[];
  page: number;
  total: number;
  totalPages: number;
};

type ReportDetail = PaymentReportRow & {
  receitasUber: string;
  receitasBolt: string;
  despesasViaVerde: string;
  despesasEletricidade: string;
  despesasCombustivel: string;
  despesasComissao: string;
  despesasIva6: string;
  despesasContaCorrente: string;
};

export function MeusPagamentosPanel() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<PaymentReportRow[]>([]);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<ReportsList>(
      `${API_PATHS.pagamentos.reports}?perPage=50`,
      {},
      getStoredToken()
    );
    setLoading(false);
    if (res.data?.items) setReports(res.data.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetailOpen(true);
    const res = await apiFetch<ReportDetail>(
      API_PATHS.pagamentos.reportById(id),
      {},
      getStoredToken()
    );
    setDetailLoading(false);
    if (res.data) setDetail(res.data);
  }

  return (
    <div className="space-y-5">
      {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> A carregar…
          </div>
        ) : reports.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Ainda não há pagamentos para si.</p>
        ) : (
          <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Período</th>
                  <th className="px-4 py-3 font-medium">Receitas</th>
                  <th className="px-4 py-3 font-medium">Despesas</th>
                  <th className="px-4 py-3 font-medium">Resultado</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {formatDatePt(row.periodStart)} – {formatDatePt(row.periodEnd)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(row.receitasTotal)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(row.despesasTotal)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {formatMoney(row.resultadoFinal)}
                    </td>
                    <td className="px-4 py-3">
                      {row.isPaid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 size={14} /> Pago
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <Clock size={14} /> Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-1 text-xs"
                        onClick={() => void openDetail(row.id)}
                      >
                        <Eye size={14} /> Detalhe
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}

      <Modal
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetail(null);
        }}
        title="Detalhe do pagamento"
        showCloseButton
      >
        {detailLoading || !detail ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> A carregar…
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">
              {formatDatePt(detail.periodStart)} – {formatDatePt(detail.periodEnd)}
            </p>
            <div className="space-y-1 rounded-lg border border-slate-200 p-3">
              <div className="flex justify-between">
                <span>Uber</span>
                <span className="tabular-nums">{formatMoney(detail.receitasUber)}</span>
              </div>
              <div className="flex justify-between">
                <span>Bolt</span>
                <span className="tabular-nums">{formatMoney(detail.receitasBolt)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Via Verde</span>
                <span className="tabular-nums">{formatMoney(detail.despesasViaVerde)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Eletricidade</span>
                <span className="tabular-nums">{formatMoney(detail.despesasEletricidade)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Combustível</span>
                <span className="tabular-nums">{formatMoney(detail.despesasCombustivel)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Comissão</span>
                <span className="tabular-nums">{formatMoney(detail.despesasComissao)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                <span>Resultado</span>
                <span className="tabular-nums">{formatMoney(detail.resultadoFinal)}</span>
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1 text-sm"
              onClick={() => {
                setDetailOpen(false);
                setDetail(null);
              }}
            >
              <X size={14} /> Fechar
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

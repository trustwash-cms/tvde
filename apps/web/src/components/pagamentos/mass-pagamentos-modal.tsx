'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Loader2,
  Mail,
  MessageCircle,
  Play,
  Square,
  Users,
} from 'lucide-react';
import { defaultPaymentWeekRange, type PaymentDriverOption } from '@tvde/shared';
import { Modal } from '@/components/modal';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

type Channel = 'email' | 'whatsapp' | 'both';
type Step = 'period' | 'drivers' | 'running' | 'done';

type Props = {
  open: boolean;
  onClose: () => void;
  drivers: PaymentDriverOption[];
  onCompleted: () => void;
  onRequestSync?: (periodStart: string, periodEnd: string) => void;
};

export function MassPagamentosModal({
  open,
  onClose,
  drivers,
  onCompleted,
  onRequestSync,
}: Props) {
  const defaults = useMemo(() => defaultPaymentWeekRange(), []);
  const [step, setStep] = useState<Step>('period');
  const [periodStart, setPeriodStart] = useState(defaults.periodStart);
  const [periodEnd, setPeriodEnd] = useState(defaults.periodEnd);
  const [channel, setChannel] = useState<Channel>('email');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [results, setResults] = useState<{ ok: number; fail: number }>({ ok: 0, fail: 0 });

  useEffect(() => {
    if (!open) return;
    const range = defaultPaymentWeekRange();
    setPeriodStart(range.periodStart);
    setPeriodEnd(range.periodEnd);
    setChannel('email');
    setSelected(new Set());
    setStep('period');
    setError('');
    setProgress({ done: 0, total: 0, current: '' });
    setResults({ ok: 0, fail: 0 });
  }, [open]);

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(drivers.map((d) => d.id)) : new Set());
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generatePayments() {
    const ids = Array.from(selected);
    if (!ids.length) {
      setError('Seleccione pelo menos um motorista');
      return;
    }
    setError('');
    setStep('running');
    setProgress({ done: 0, total: ids.length, current: '' });
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const driver = drivers.find((d) => d.id === id);
      setProgress({
        done: i,
        total: ids.length,
        current: driver?.label || id,
      });
      const res = await apiFetch(
        API_PATHS.pagamentos.confirm,
        {
          method: 'POST',
          body: JSON.stringify({ userId: id, periodStart, periodEnd }),
        },
        getStoredToken()
      );
      if (res.success) ok += 1;
      else fail += 1;
    }

    setProgress({ done: ids.length, total: ids.length, current: '' });
    setResults({ ok, fail });
    setStep('done');
    onCompleted();
  }

  const channelHint =
    channel === 'email'
      ? 'Envio por email será ligado em breve — por agora só gera os relatórios.'
      : channel === 'whatsapp'
        ? 'Envio por WhatsApp será ligado em breve — por agora só gera os relatórios.'
        : 'Email + WhatsApp serão ligados em breve — por agora só gera os relatórios.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pagamentos em massa"
      showCloseButton={step !== 'running'}
      closeOnBackdrop={step !== 'running'}
      closeOnEscape={step !== 'running'}
      panelClassName="max-w-xl"
      scrollBody
      footer={
        step === 'period' ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Fechar
            </button>
            {onRequestSync ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onRequestSync(periodStart, periodEnd)}
              >
                Sincronizar primeiro
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary"
              disabled={!periodStart || !periodEnd}
              onClick={() => {
                if (periodEnd < periodStart) {
                  setError('Data de fim anterior à de início');
                  return;
                }
                setError('');
                setStep('drivers');
              }}
            >
              Seguinte
            </button>
          </div>
        ) : step === 'drivers' ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setStep('period')}>
              Anterior
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={!selected.size}
              onClick={() => void generatePayments()}
            >
              <Play className="h-4 w-4" />
              Gerar pagamentos ({selected.size})
            </button>
          </div>
        ) : step === 'done' ? (
          <button type="button" className="btn-primary" onClick={onClose}>
            Fechar
          </button>
        ) : null
      }
    >
      <div className="space-y-4">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {step === 'period' ? (
          <>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Período e canal de envio</h3>
              <p className="mt-1 text-sm text-slate-500">
                Serão gerados relatórios para o intervalo seleccionado. Depois escolha os
                motoristas.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Data início</span>
                <input
                  type="date"
                  className="input w-full"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Data fim</span>
                <input
                  type="date"
                  className="input w-full"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => {
                const r = defaultPaymentWeekRange();
                setPeriodStart(r.periodStart);
                setPeriodEnd(r.periodEnd);
              }}
            >
              Semana anterior
            </button>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Canal de envio</legend>
              {(
                [
                  ['email', 'Apenas Email', Mail],
                  ['whatsapp', 'Apenas WhatsApp', MessageCircle],
                  ['both', 'Email e WhatsApp', Users],
                ] as const
              ).map(([value, label, Icon]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="channel"
                    checked={channel === value}
                    onChange={() => setChannel(value)}
                  />
                  <Icon className="h-4 w-4 text-slate-500" />
                  {label}
                </label>
              ))}
              <p className="text-xs text-slate-500">{channelHint}</p>
            </fieldset>
          </>
        ) : null}

        {step === 'drivers' ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Seleccionar motoristas</h3>
                <p className="text-xs text-slate-500">
                  {periodStart} → {periodEnd}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 text-xs"
                  onClick={() => toggleAll(true)}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  Seleccionar todos
                </button>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 text-xs"
                  onClick={() => toggleAll(false)}
                >
                  <Square className="h-3.5 w-3.5" />
                  Desmarcar
                </button>
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Dica: use «Seleccionar todos» para gerar pagamentos a todos os motoristas com
              viatura.
            </div>
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {drivers.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggleOne(d.id)}
                    />
                    <span className="font-medium text-slate-800">{d.label}</span>
                    {d.email ? (
                      <span className="text-xs text-slate-400">{d.email}</span>
                    ) : null}
                  </label>
                </li>
              ))}
              {!drivers.length ? (
                <li className="px-2 py-6 text-center text-sm text-slate-400">
                  Sem motoristas com viatura
                </li>
              ) : null}
            </ul>
            <p className="text-xs text-slate-500">{selected.size} motorista(s) seleccionado(s)</p>
          </>
        ) : null}

        {step === 'running' ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
            <p className="text-sm text-slate-600">
              A gerar {progress.done + 1} de {progress.total}
              {progress.current ? ` · ${progress.current}` : ''}
            </p>
          </div>
        ) : null}

        {step === 'done' ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-5 text-center text-sm text-emerald-900">
            <p className="font-semibold">Pagamentos gerados</p>
            <p className="mt-1">
              {results.ok} OK
              {results.fail ? ` · ${results.fail} falharam` : ''}
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

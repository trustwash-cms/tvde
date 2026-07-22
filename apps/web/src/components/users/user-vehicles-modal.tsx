'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  API_PATHS,
  VEHICLE_COMMISSION_TYPES,
  VEHICLE_COMMISSION_TYPE_LABELS,
  formatDateOnlyInput,
  formatUserVehicleMatricula,
  isUserVehicleActive,
  type UserVehicleRecord,
  type VehicleCommissionType,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import type { UserListItem } from '@/components/users/user-list-card';
import clsx from 'clsx';
import { Pencil, Plus, Trash2 } from 'lucide-react';

type PlatformDriverOption = { uuid: string; label: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Só aceita UUIDs reais — ignora textos placeholder guardados por engano. */
function sanitizePlatformUuid(value: string | null | undefined): string {
  const t = (value ?? '').trim();
  return UUID_RE.test(t) ? t : '';
}

function shortUuid(uuid: string) {
  const t = uuid.trim();
  if (t.length <= 12) return t;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function DriverUuidSelect({
  label,
  value,
  options,
  loading,
  emptyHint,
  onChange,
}: {
  label: string;
  value: string;
  options: PlatformDriverOption[];
  loading: boolean;
  emptyHint: string;
  onChange: (uuid: string) => void;
}) {
  const safeValue = sanitizePlatformUuid(value);
  const optionsWithCurrent = useMemo(() => {
    if (!safeValue) return options;
    const exists = options.some((o) => o.uuid.toLowerCase() === safeValue.toLowerCase());
    if (exists) return options;
    return [{ uuid: safeValue, label: `${shortUuid(safeValue)} (actual)` }, ...options];
  }, [options, safeValue]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <select
        className="input"
        value={safeValue}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Nenhum —</option>
        {optionsWithCurrent.map((opt) => (
          <option key={opt.uuid} value={opt.uuid}>
            {opt.label} · {shortUuid(opt.uuid)}
          </option>
        ))}
      </select>
      {!loading && !options.length ? (
        <p className="mt-1 text-xs text-slate-500">{emptyHint}</p>
      ) : null}
    </div>
  );
}

function emptyForm(): Record<string, string | boolean> {
  return {
    matricula: '',
    matriculaForeign: false,
    matriculaCountry: 'PT',
    dataInicio: formatDateOnlyInput(new Date()),
    dataFim: '',
    uuidUber: '',
    uuidBolt: '',
    numCartaoPrio: '',
    nomeCompleto: '',
    marca: '',
    modelo: '',
    ano: '',
    aluguelViatura: '',
    comissaoTipo: '',
    comissaoValor: '',
    comissaoIva6: false,
    slotIncluirViaVerde: false,
    slotIncluirEletricidadeCombustivel: false,
  };
}

function vehicleToForm(vehicle: UserVehicleRecord): Record<string, string | boolean> {
  return {
    matricula: vehicle.matricula,
    matriculaForeign: vehicle.matriculaForeign,
    matriculaCountry: vehicle.matriculaCountry,
    dataInicio: vehicle.dataInicio,
    dataFim: vehicle.dataFim ?? '',
    uuidUber: sanitizePlatformUuid(vehicle.uuidUber),
    uuidBolt: sanitizePlatformUuid(vehicle.uuidBolt),
    numCartaoPrio: vehicle.numCartaoPrio ?? '',
    nomeCompleto: vehicle.nomeCompleto ?? '',
    marca: vehicle.marca ?? '',
    modelo: vehicle.modelo ?? '',
    ano: vehicle.ano ? String(vehicle.ano) : '',
    aluguelViatura: vehicle.aluguelViatura ?? '',
    comissaoTipo: vehicle.comissaoTipo ?? '',
    comissaoValor: vehicle.comissaoValor ?? '',
    comissaoIva6: vehicle.comissaoIva6,
    slotIncluirViaVerde: vehicle.slotIncluirViaVerde,
    slotIncluirEletricidadeCombustivel: vehicle.slotIncluirEletricidadeCombustivel,
  };
}

function buildPayload(form: Record<string, string | boolean>) {
  return {
    matricula: String(form.matricula),
    matriculaForeign: Boolean(form.matriculaForeign),
    matriculaCountry: String(form.matriculaCountry || 'PT'),
    dataInicio: String(form.dataInicio),
    dataFim: String(form.dataFim).trim() ? String(form.dataFim) : null,
    uuidUber: sanitizePlatformUuid(String(form.uuidUber)) || null,
    uuidBolt: sanitizePlatformUuid(String(form.uuidBolt)) || null,
    numCartaoPrio: String(form.numCartaoPrio).trim() || null,
    nomeCompleto: String(form.nomeCompleto).trim() || null,
    marca: String(form.marca).trim() || null,
    modelo: String(form.modelo).trim() || null,
    ano: String(form.ano).trim() || null,
    aluguelViatura: String(form.aluguelViatura).trim() || null,
    comissaoTipo: String(form.comissaoTipo) || null,
    comissaoValor: String(form.comissaoValor).trim() || null,
    comissaoIva6: Boolean(form.comissaoIva6),
    slotIncluirViaVerde: Boolean(form.slotIncluirViaVerde),
    slotIncluirEletricidadeCombustivel: Boolean(form.slotIncluirEletricidadeCombustivel),
  };
}

export function UserVehiclesModal({
  open,
  user,
  onClose,
}: {
  open: boolean;
  user: UserListItem | null;
  onClose: () => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [vehicles, setVehicles] = useState<UserVehicleRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [uberDrivers, setUberDrivers] = useState<PlatformDriverOption[]>([]);
  const [boltDrivers, setBoltDrivers] = useState<PlatformDriverOption[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);

  const comissaoTipo = String(form.comissaoTipo) as VehicleCommissionType | '';
  const showCommissionOptions = comissaoTipo === 'percentagem' || comissaoTipo === 'slot';

  function loadVehicles() {
    if (!user) return;
    setLoading(true);
    setError('');
    apiFetch<UserVehicleRecord[]>(API_PATHS.users.vehicles(user.id)).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setVehicles(res.data);
        return;
      }
      setError(getApiErrorMessage(res));
    });
  }

  function loadPlatformDrivers() {
    setLoadingDrivers(true);
    apiFetch<{ uber: PlatformDriverOption[]; bolt: PlatformDriverOption[] }>(
      API_PATHS.users.vehiclePlatformDrivers
    ).then((res) => {
      setLoadingDrivers(false);
      if (res.success && res.data) {
        setUberDrivers(res.data.uber);
        setBoltDrivers(res.data.bolt);
      }
    });
  }

  useEffect(() => {
    if (!open || !user) return;
    setEditingId(null);
    setShowForm(false);
    setForm(emptyForm());
    loadVehicles();
    loadPlatformDrivers();
  }, [open, user]);

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setError('');
  }

  function openEditForm(vehicle: UserVehicleRecord) {
    setEditingId(vehicle.id);
    setForm(vehicleToForm(vehicle));
    setShowForm(true);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;

    setSubmitting(true);
    setError('');

    const payload = buildPayload(form);
    const path = editingId
      ? API_PATHS.users.vehicleById(user.id, editingId)
      : API_PATHS.users.vehicles(user.id);

    const res = await apiFetch<UserVehicleRecord>(path, {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    setSubmitting(false);

    if (res.success) {
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      loadVehicles();
      return;
    }

    setError(getApiErrorMessage(res));
  }

  async function handleDelete(vehicle: UserVehicleRecord) {
    if (!user) return;
    const ok = await confirm({
      title: 'Eliminar matrícula',
      message: `Eliminar matrícula ${formatUserVehicleMatricula(vehicle)}?`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    setSubmitting(true);
    setError('');
    const res = await apiFetch(API_PATHS.users.vehicleById(user.id, vehicle.id), {
      method: 'DELETE',
    });
    setSubmitting(false);

    if (res.success) {
      loadVehicles();
      return;
    }
    setError(getApiErrorMessage(res));
  }

  const displayName = user?.username ?? user?.email?.split('@')[0] ?? '';

  return (
    <>
    {confirmDialog}
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `Matrículas — ${displayName}` : 'Matrículas'}
      panelClassName="max-w-3xl"
      scrollBody
      showCloseButton
      footer={
        showForm ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="user-vehicle-form"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? 'A guardar…' : editingId ? 'Guardar alterações' : 'Adicionar matrícula'}
            </button>
          </div>
        ) : (
          <div className="flex justify-between gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Fechar
            </button>
            <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openCreateForm}>
              <Plus size={16} />
              Adicionar matrícula
            </button>
          </div>
        )
      }
    >
      {loading ? (
        <p className="text-sm text-slate-500">A carregar matrículas…</p>
      ) : showForm ? (
        <form id="user-vehicle-form" onSubmit={handleSubmit} className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Matrícula</label>
              <input
                className="input"
                value={String(form.matricula)}
                onChange={(e) => setForm({ ...form, matricula: e.target.value.toUpperCase() })}
                placeholder="AA-00-BB"
                required
              />
            </div>
            <div className="flex items-end gap-3 pb-1">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.matriculaForeign)}
                  onChange={(e) => setForm({ ...form, matriculaForeign: e.target.checked })}
                />
                Matrícula estrangeira
              </label>
            </div>
            {form.matriculaForeign ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">País</label>
                <input
                  className="input"
                  value={String(form.matriculaCountry)}
                  onChange={(e) => setForm({ ...form, matriculaCountry: e.target.value.toUpperCase() })}
                  maxLength={2}
                />
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Data início</label>
              <input
                type="date"
                className="input"
                value={String(form.dataInicio)}
                onChange={(e) => setForm({ ...form, dataInicio: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Data fim</label>
              <input
                type="date"
                className="input"
                value={String(form.dataFim)}
                onChange={(e) => setForm({ ...form, dataFim: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-500">Vazio = activa</p>
            </div>
            <DriverUuidSelect
              label="UUID Uber"
              value={String(form.uuidUber)}
              options={uberDrivers}
              loading={loadingDrivers}
              emptyHint="Sem motoristas Uber — importe/sincronize pagamentos Uber primeiro."
              onChange={(uuid) => setForm({ ...form, uuidUber: uuid })}
            />
            <DriverUuidSelect
              label="UUID Bolt"
              value={String(form.uuidBolt)}
              options={boltDrivers}
              loading={loadingDrivers}
              emptyHint="Sem motoristas Bolt — sincronize a frota Bolt primeiro."
              onChange={(uuid) => setForm({ ...form, uuidBolt: uuid })}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Cartão PRIO</label>
              <input
                className="input"
                value={String(form.numCartaoPrio)}
                onChange={(e) => setForm({ ...form, numCartaoPrio: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome completo (PRIO)</label>
              <input
                className="input"
                value={String(form.nomeCompleto)}
                onChange={(e) => setForm({ ...form, nomeCompleto: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Marca</label>
              <input className="input" value={String(form.marca)} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Modelo</label>
              <input className="input" value={String(form.modelo)} onChange={(e) => setForm({ ...form, modelo: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Ano</label>
              <input className="input" value={String(form.ano)} onChange={(e) => setForm({ ...form, ano: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Aluguer viatura (€)</label>
              <input
                className="input"
                value={String(form.aluguelViatura)}
                onChange={(e) => setForm({ ...form, aluguelViatura: e.target.value })}
                placeholder="Opcional — vazio = NULL"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-800">Comissão</h4>
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="comissaoTipo"
                  checked={!form.comissaoTipo}
                  onChange={() => setForm({ ...form, comissaoTipo: '', comissaoValor: '' })}
                />
                Nenhuma
              </label>
              {VEHICLE_COMMISSION_TYPES.map((type) => (
                <label key={type} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="comissaoTipo"
                    checked={form.comissaoTipo === type}
                    onChange={() => setForm({ ...form, comissaoTipo: type })}
                  />
                  {VEHICLE_COMMISSION_TYPE_LABELS[type]}
                </label>
              ))}
            </div>

            {comissaoTipo ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {comissaoTipo === 'percentagem' ? 'Percentagem (%)' : 'Valor (€)'}
                  </label>
                  <input
                    className="input"
                    value={String(form.comissaoValor)}
                    onChange={(e) => setForm({ ...form, comissaoValor: e.target.value })}
                    required
                  />
                </div>
                <div className="flex flex-col justify-end gap-1 pb-1">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(form.comissaoIva6)}
                      onChange={(e) => setForm({ ...form, comissaoIva6: e.target.checked })}
                    />
                    IVA 6%
                  </label>
                  <p className="text-xs text-slate-500">
                    6% sobre receitas Uber e Bolt (linhas separadas no relatório). Não aumenta a
                    comissão.
                  </p>
                </div>
              </div>
            ) : null}

            {showCommissionOptions ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-500">
                  {comissaoTipo === 'percentagem'
                    ? 'Desmarcado = excluir da base de cálculo'
                    : 'Marcado = subtrair do resultado final'}
                </p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(form.slotIncluirViaVerde)}
                    onChange={(e) => setForm({ ...form, slotIncluirViaVerde: e.target.checked })}
                  />
                  Via Verde
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(form.slotIncluirEletricidadeCombustivel)}
                    onChange={(e) => setForm({ ...form, slotIncluirEletricidadeCombustivel: e.target.checked })}
                  />
                  Eletricidade / Combustível
                </label>
              </div>
            ) : null}
          </section>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </form>
      ) : (
        <div className="space-y-3">
          {vehicles.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma matrícula registada.</p>
          ) : (
            vehicles.map((vehicle) => {
              const active = isUserVehicleActive(vehicle.dataFim);
              return (
                <article
                  key={vehicle.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-slate-900">
                        {formatUserVehicleMatricula(vehicle)}
                      </h4>
                      <span
                        className={clsx(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                          active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        )}
                      >
                        {active ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {vehicle.dataInicio}
                      {vehicle.dataFim ? ` → ${vehicle.dataFim}` : ' → presente'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {[vehicle.marca, vehicle.modelo, vehicle.ano].filter(Boolean).join(' · ') || 'Sem marca/modelo'}
                    </p>
                    {vehicle.comissaoTipo ? (
                      <p className="mt-1 text-xs text-slate-600">
                        {VEHICLE_COMMISSION_TYPE_LABELS[vehicle.comissaoTipo]}: {vehicle.comissaoValor}
                        {vehicle.comissaoTipo === 'percentagem' ? '%' : '€'}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-sky-600 hover:bg-sky-50"
                      title="Editar"
                      onClick={() => openEditForm(vehicle)}
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                      title="Eliminar"
                      onClick={() => handleDelete(vehicle)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </article>
              );
            })
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      )}
    </Modal>
    </>
  );
}

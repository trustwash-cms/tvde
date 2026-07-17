'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  buildUserPhone,
  getAssignableRoles,
  getRoleLabel,
  isPasswordStrong,
  isValidUserPhone,
  isValidUsername,
  normalizeUsername,
  roleRequiresPhone,
  USER_STATUS_OPTIONS,
  type Role,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import { PasswordRequirements } from '@/components/users/password-requirements';

export interface TenantOption {
  id: string;
  siteId: string;
  name: string;
}

export interface CreateUserFormValues {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: string;
  status: string;
  phoneCountryCode: string;
  phoneNumber: string;
  fullName: string;
  tenantId: string;
}

const EMPTY_FORM: CreateUserFormValues = {
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: 'staff',
  status: 'active',
  phoneCountryCode: '+351',
  phoneNumber: '',
  fullName: '',
  tenantId: '',
};

export function CreateUserModal({
  open,
  onClose,
  onSubmit,
  isMaster,
  actorRole,
  tenants,
  defaultTenantId,
  inheritedSiteId,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, string>) => Promise<{ ok: boolean; credentialsSent?: boolean }>;
  isMaster: boolean;
  actorRole: Role;
  tenants: TenantOption[];
  defaultTenantId: string;
  inheritedSiteId: string | null;
}) {
  const assignableRoles = useMemo(() => getAssignableRoles(actorRole), [actorRole]);
  const [form, setForm] = useState<CreateUserFormValues>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.id === form.tenantId),
    [tenants, form.tenantId]
  );

  const siteIdDisplay = isMaster ? selectedTenant?.siteId ?? '—' : inheritedSiteId ?? '—';
  const inheritedHintSiteId = isMaster ? selectedTenant?.siteId : inheritedSiteId;
  const phoneRequired = roleRequiresPhone(form.role);
  const usingManualPassword = Boolean(form.password.trim() || form.confirmPassword.trim());
  const defaultRole = isMaster ? 'superadmin' : assignableRoles[0] ?? 'staff';

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm({
      ...EMPTY_FORM,
      role: defaultRole,
      tenantId: defaultTenantId,
    });
  }, [open, defaultRole, defaultTenantId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const username = normalizeUsername(form.username);
    if (!isValidUsername(username)) {
      setError('Username inválido — apenas letras e pontos (ex.: joao.silva). Números não são permitidos.');
      return;
    }

    const email = form.email.trim();
    if (!email) {
      setError('Indique o email do utilizador.');
      return;
    }

    if (usingManualPassword) {
      if (!isPasswordStrong(form.password)) {
        setError('A password não cumpre todos os requisitos de segurança.');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError('As passwords não coincidem.');
        return;
      }
    }

    if (isMaster && !form.tenantId) {
      setError('Seleccione o tenant (cliente) para o novo utilizador.');
      return;
    }

    if (phoneRequired) {
      if (!isValidUserPhone(form.phoneCountryCode, form.phoneNumber)) {
        setError('Indique um telefone válido (obrigatório para Gestor de Frota e Motorista).');
        return;
      }
    } else if (form.phoneNumber.trim() && !isValidUserPhone(form.phoneCountryCode, form.phoneNumber)) {
      setError('Indique um telefone válido ou deixe o campo vazio.');
      return;
    }

    const payload: Record<string, string> = {
      username,
      email,
      role: form.role,
      status: form.status,
    };
    if (usingManualPassword) payload.password = form.password;

    if (form.fullName.trim()) payload.fullName = form.fullName.trim();
    if (form.phoneNumber.trim()) {
      payload.phone = buildUserPhone(form.phoneCountryCode, form.phoneNumber);
    }
    if (isMaster && form.tenantId) payload.tenantId = form.tenantId;

    setSubmitting(true);
    const result = await onSubmit(payload);
    setSubmitting(false);
    if (result.ok) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Criar utilizador"
      showCloseButton
      scrollBody
      panelClassName="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" form="create-user-form" className="btn-primary" disabled={submitting}>
            {submitting ? 'A criar…' : 'Criar'}
          </button>
        </div>
      }
    >
      <form id="create-user-form" onSubmit={handleSubmit} noValidate autoComplete="off" className="space-y-4">
        {isMaster && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Tenant (cliente)</label>
            <select
              className="input"
              value={form.tenantId}
              onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
            >
              <option value="">Seleccionar…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.siteId} — {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="joao.silva"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-slate-500">
            Apenas letras e um ponto opcional. Não são permitidos números.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Telefone (WhatsApp)
            {phoneRequired ? <span className="text-red-500"> *</span> : null}
          </label>
          <div className="flex gap-2">
            <input
              className="input w-24 shrink-0"
              value={form.phoneCountryCode}
              onChange={(e) => setForm({ ...form, phoneCountryCode: e.target.value })}
              placeholder="+351"
              aria-label="Código país"
            />
            <input
              className="input min-w-0 flex-1"
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value.replace(/\D/g, '') })}
              placeholder="Ex: 912345678"
              inputMode="numeric"
              aria-label="Número de telefone"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Usado para enviar mensagens WhatsApp
            {phoneRequired ? ' (obrigatório para Gestor de Frota e Motorista)' : ' (opcional para Staff)'}.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {getRoleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Status</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {USER_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Site ID</label>
            <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">Auto-herdado</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {siteIdDisplay}
          </div>
          {inheritedHintSiteId ? (
            <p className="mt-1 text-xs text-slate-500">
              Novos users herdam automaticamente o site_id ({inheritedHintSiteId})
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Nome completo</label>
          <input
            className="input"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            placeholder="Ex: João Silva"
            autoComplete="name"
          />
          <p className="mt-1 text-xs text-slate-500">
            Opcional. Usado em emails personalizados (ex.: relatórios de pagamento).
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Password (opcional)</label>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Deixe em branco para gerar automaticamente"
            autoComplete="new-password"
          />
          <p className="mt-1 text-xs text-slate-500">
            Deixe em branco para gerar uma password segura automaticamente. A password será enviada por email ao
            utilizador.
          </p>
          {usingManualPassword ? (
            <div className="mt-3 space-y-3">
              <PasswordRequirements password={form.password} />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Confirmar password</label>
                <input
                  className="input"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </Modal>
  );
}

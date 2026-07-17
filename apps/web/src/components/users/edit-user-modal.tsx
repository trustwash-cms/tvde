'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  buildUserPhone,
  getAssignableRoles,
  getRoleLabel,
  isValidUserPhone,
  isValidUsername,
  normalizeUsername,
  roleRequiresPhone,
  splitUserPhone,
  USER_STATUS_OPTIONS,
  type Role,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import type { UserListItem } from '@/components/users/user-list-card';

export function EditUserModal({
  open,
  user,
  onClose,
  onSubmit,
  actorRole,
  canChangeStatus,
}: {
  open: boolean;
  user: UserListItem | null;
  onClose: () => void;
  onSubmit: (userId: string, payload: Record<string, string>) => Promise<boolean>;
  actorRole: Role;
  canChangeStatus: boolean;
}) {
  const assignableRoles = user
    ? getAssignableRoles(actorRole).filter((r) => r === user.role || canAssignTarget(actorRole, user.role as Role, r))
    : [];
  const [form, setForm] = useState({
    username: '',
    email: '',
    role: 'staff',
    status: 'active',
    phoneCountryCode: '+351',
    phoneNumber: '',
    fullName: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const phoneRequired = roleRequiresPhone(form.role);

  useEffect(() => {
    if (!open || !user) return;
    const phone = splitUserPhone(user.phone);
    setError('');
    setForm({
      username: user.username ?? '',
      email: user.email,
      role: user.role,
      status: user.status,
      phoneCountryCode: phone.countryCode,
      phoneNumber: phone.number,
      fullName: user.fullName ?? '',
    });
  }, [open, user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
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
    };
    if (canChangeStatus) payload.status = form.status;
    if (form.fullName.trim()) payload.fullName = form.fullName.trim();
    if (form.phoneNumber.trim()) {
      payload.phone = buildUserPhone(form.phoneCountryCode, form.phoneNumber);
    }

    setSubmitting(true);
    const ok = await onSubmit(user.id, payload);
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar utilizador"
      showCloseButton
      scrollBody
      panelClassName="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" form="edit-user-form" className="btn-primary" disabled={submitting || !user}>
            {submitting ? 'A guardar…' : 'Guardar'}
          </button>
        </div>
      }
    >
      {user ? (
        <form id="edit-user-form" onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
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
              />
              <input
                className="input min-w-0 flex-1"
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value.replace(/\D/g, '') })}
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
              <select
                className="input"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {(assignableRoles.length ? assignableRoles : [user.role as Role]).map((r) => (
                  <option key={r} value={r}>
                    {getRoleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            {canChangeStatus ? (
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
            ) : null}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Nome completo</label>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </form>
      ) : null}
    </Modal>
  );
}

function canAssignTarget(actor: Role, current: Role, target: Role): boolean {
  const roles = getAssignableRoles(actor);
  return roles.includes(target) || target === current;
}

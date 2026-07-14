'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CALENDAR_TIMEZONE_OPTIONS, DEFAULT_CALENDAR_TIMEZONE, WEB_ROUTES, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { CALENDAR_COLORS, CALENDAR_VISIBILITY_LABELS } from '@/components/calendar/calendar-constants';
import type { CalendarRecord, CalendarUser } from '@/components/calendar/calendar-types';
import { SettingsCalendarEmailTemplate } from '@/components/settings/settings-calendar-email-template';
import { SettingsCalendarWhatsappNotification } from '@/components/settings/settings-calendar-whatsapp-notification';
import { SettingsCalendarScheduledInvoice } from '@/components/settings/settings-calendar-scheduled-invoice';

export function SettingsCalendarPanel() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [userRole, setUserRole] = useState<Role | null>(null);
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [calendars, setCalendars] = useState<CalendarRecord[]>([]);
  const [users, setUsers] = useState<CalendarUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [createForm, setCreateForm] = useState<{
    name: string;
    color: string;
    visibility: 'private' | 'workspace' | 'shared';
    isDefault: boolean;
    timezone: string;
  }>({
    name: '',
    color: CALENDAR_COLORS[0],
    visibility: 'private',
    isDefault: false,
    timezone: DEFAULT_CALENDAR_TIMEZONE,
  });

  const [editForm, setEditForm] = useState<{
    name: string;
    color: string;
    visibility: 'private' | 'workspace' | 'shared';
    isDefault: boolean;
    timezone: string;
  }>({
    name: '',
    color: CALENDAR_COLORS[0],
    visibility: 'private',
    isDefault: false,
    timezone: DEFAULT_CALENDAR_TIMEZONE,
  });

  const [memberIds, setMemberIds] = useState<string[]>([]);

  const selected = calendars.find((c) => c.id === selectedId) ?? null;

  const load = useCallback(() => {
    if (!workspaceId) return;
    const token = getStoredToken();
    Promise.all([
      apiFetch<CalendarRecord[]>(
        withWorkspaceQuery(API_PATHS.calendar.calendars, workspaceId),
        {},
        token
      ),
      apiFetch<CalendarUser[]>(
        withWorkspaceQuery(API_PATHS.calendar.shareableUsers, workspaceId),
        {},
        token
      ),
    ]).then(([calRes, userRes]) => {
      if (calRes.data) setCalendars(calRes.data);
      if (userRes.data) setUsers(userRes.data);
    });
  }, [workspaceId]);

  useEffect(() => {
    if (!calendars.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !calendars.some((c) => c.id === selectedId)) {
      setSelectedId(calendars[0].id);
    }
  }, [calendars, selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setUserRole(res.data.role);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setEditForm({
      name: selected.name,
      color: selected.color,
      visibility: selected.visibility,
      isDefault: selected.isDefault,
      timezone: selected.timezone,
    });
    setMemberIds(
      selected.members.filter((m) => m.role !== 'owner').map((m) => m.userId)
    );
  }, [selected]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.calendar.calendars,
      {
        method: 'POST',
        body: JSON.stringify({ workspaceId, ...createForm }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Calendário criado');
      setCreateForm({
        name: '',
        color: CALENDAR_COLORS[0],
        visibility: 'private',
        isDefault: false,
        timezone: DEFAULT_CALENDAR_TIMEZONE,
      });
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.calendar.calendarById(selected.id),
      {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Calendário actualizado');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function handleSaveMembers() {
    if (!selected) return;
    setLoading(true);
    setError('');
    const members = memberIds.map((userId) => ({
      userId,
      role: 'viewer' as const,
      notifyChanges: true,
    }));
    const res = await apiFetch(API_PATHS.calendar.calendarMembers(selected.id), {
      method: 'PUT',
      body: JSON.stringify({ members }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Membros actualizados');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function handleDelete() {
    if (!selected) return;
    const ok = await confirm({
      title: 'Eliminar calendário',
      message: `Eliminar o calendário «${selected.name}»? Todos os eventos serão apagados.`,
      confirmLabel: 'Eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.calendar.calendarById(selected.id),
      { method: 'DELETE' },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Calendário eliminado');
      setSelectedId(null);
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  function toggleMember(userId: string) {
    setMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Calendário</h2>
        <p className="mt-1 text-sm text-slate-500">
          Crie e gira os seus calendários por workspace. A vista de agenda está em{' '}
          <Link href={WEB_ROUTES.dashboard.calendar} className="text-[var(--color-primary)] underline">
            Calendário
          </Link>
          .
        </p>
      </div>

      <SettingsAlerts
        error={error}
        success={success}
        onDismissError={() => setError('')}
        onDismissSuccess={() => setSuccess('')}
      />

      <WorkspaceSelector
        workspaces={workspaces}
        workspaceId={workspaceId}
        onChange={setWorkspaceId}
      />

      {!wsLoading && !workspaceId && (
        <p className="text-sm text-amber-700">Seleccione um workspace.</p>
      )}

      {workspaceId && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card space-y-4">
            <h3 className="font-medium text-slate-900">Novo calendário</h3>
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                className="input"
                placeholder="Nome (ex. Macbusinesss)"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
              />
              <div className="flex flex-wrap gap-2">
                {CALENDAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-7 w-7 rounded-full border-2 ${
                      createForm.color === c ? 'border-slate-800' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => setCreateForm({ ...createForm, color: c })}
                  />
                ))}
              </div>
              <select
                className="input"
                value={createForm.visibility}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    visibility: e.target.value as typeof createForm.visibility,
                  })
                }
              >
                {Object.entries(CALENDAR_VISIBILITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Fuso horário (GMT)</label>
                <select
                  className="input"
                  value={createForm.timezone}
                  onChange={(e) => setCreateForm({ ...createForm, timezone: e.target.value })}
                >
                  {CALENDAR_TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createForm.isDefault}
                  onChange={(e) => setCreateForm({ ...createForm, isDefault: e.target.checked })}
                />
                Calendário por defeito
              </label>
              <button type="submit" className="btn-primary" disabled={loading}>
                Criar calendário
              </button>
            </form>
          </section>

          <section className="card space-y-4">
            <h3 className="font-medium text-slate-900">Os seus calendários</h3>
            {calendars.length === 0 ? (
              <p className="text-sm text-slate-500">Ainda não tem calendários neste workspace.</p>
            ) : (
              <ul className="space-y-1">
                {calendars.map((cal) => (
                  <li key={cal.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                        selectedId === cal.id
                          ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                          : 'hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedId(cal.id)}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: cal.color }}
                      />
                      <span className="truncate font-medium">{cal.name}</span>
                      {cal.isDefault && (
                        <span className="ml-auto text-[10px] uppercase text-slate-400">defeito</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <SettingsCalendarEmailTemplate userRole={userRole} />

      <SettingsCalendarWhatsappNotification userRole={userRole} workspaceId={workspaceId} />

      <SettingsCalendarScheduledInvoice userRole={userRole} workspaceId={workspaceId} />

      {selected && (
        <section className="card space-y-6">
          <h3 className="font-medium text-slate-900">Editar «{selected.name}»</h3>

          <form onSubmit={handleSaveEdit} className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-600">Nome</label>
              <input
                className="input"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Visibilidade</label>
              <select
                className="input"
                value={editForm.visibility}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    visibility: e.target.value as typeof editForm.visibility,
                  })
                }
              >
                {Object.entries(CALENDAR_VISIBILITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Fuso horário (GMT)</label>
              <select
                className="input"
                value={editForm.timezone}
                onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })}
              >
                {CALENDAR_TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-xs text-slate-600">Cor</label>
              <div className="flex flex-wrap gap-2">
                {CALENDAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-7 w-7 rounded-full border-2 ${
                      editForm.color === c ? 'border-slate-800' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => setEditForm({ ...editForm, color: c })}
                  />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={editForm.isDefault}
                onChange={(e) => setEditForm({ ...editForm, isDefault: e.target.checked })}
              />
              Calendário por defeito
            </label>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <button type="submit" className="btn-primary" disabled={loading}>
                Guardar
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleDelete}
                disabled={loading}
              >
                Eliminar calendário
              </button>
            </div>
          </form>

          {selected.visibility === 'shared' && users.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <h4 className="mb-2 text-sm font-medium text-slate-800">Membros com acesso</h4>
              <p className="mb-3 text-xs text-slate-500">
                Utilizadores do tenant que podem ver este calendário partilhado.
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {users
                  .filter((u) => u.id !== selected.ownerUserId)
                  .map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={memberIds.includes(u.id)}
                        onChange={() => toggleMember(u.id)}
                      />
                      <span className="truncate">{u.email}</span>
                    </label>
                  ))}
              </div>
              <button
                type="button"
                className="btn-secondary mt-3"
                onClick={handleSaveMembers}
                disabled={loading}
              >
                Guardar membros
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

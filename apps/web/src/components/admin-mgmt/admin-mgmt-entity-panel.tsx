'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

export type AdminMgmtFieldType = 'text' | 'date' | 'number' | 'decimal' | 'textarea' | 'select' | 'boolean';

export interface AdminMgmtFieldConfig {
  key: string;
  label: string;
  type: AdminMgmtFieldType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  listKeys?: string[];
}

export interface AdminMgmtEntityConfig {
  title: string;
  listPath: string;
  createPath: string;
  deletePathForId: (id: string) => string;
  fields: AdminMgmtFieldConfig[];
  emptyLabel?: string;
}

function emptyForm(fields: AdminMgmtFieldConfig[]): Record<string, string | boolean> {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.type === 'boolean' ? false : ''])
  );
}

function rowPreview(row: Record<string, unknown>, keys: string[]): string {
  return keys
    .map((key) => row[key])
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}

import {
  ADMIN_MGMT_ENTITY_CONFIGS,
  type AdminMgmtEntityKey,
} from '@/components/admin-mgmt/admin-mgmt-entity-configs';

export function AdminMgmtEntityPanel({ entityKey }: { entityKey: AdminMgmtEntityKey }) {
  const config = ADMIN_MGMT_ENTITY_CONFIGS[entityKey];
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>(() => emptyForm(config.fields));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const previewKeys =
    config.fields.filter((f) => f.listKeys).flatMap((f) => f.listKeys ?? []) ||
    config.fields.slice(0, 3).map((f) => f.key);

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    apiFetch<Array<Record<string, unknown>>>(
      withWorkspaceQuery(config.listPath, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      setLoading(false);
      if (res.data) setRows(res.data);
      else setError(getApiErrorMessage(res));
    });
  }

  useEffect(load, [workspaceId, config.listPath]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    const payload = {
      workspaceId,
      ...Object.fromEntries(
        Object.entries(form).map(([key, value]) => [
          key,
          typeof value === 'boolean' ? value : String(value).trim() || null,
        ])
      ),
    };
    const res = await apiFetch(config.createPath, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, getStoredToken());
    setSaving(false);
    if (res.success) {
      setModalOpen(false);
      setForm(emptyForm(config.fields));
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function remove(id: string, label: string) {
    if (!workspaceId) return;
    const ok = await confirm(`Eliminar ${label}?`);
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(config.deletePathForId(id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) load();
    else setError(getApiErrorMessage(res));
  }

  if (!workspaceId) return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{config.title}</h2>
          <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" onClick={() => setModalOpen(true)}>
            <Plus size={14} />
            Novo registo
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">{config.emptyLabel ?? 'Nenhum registo.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-2">Resumo</th>
                  <th className="px-3 py-2 text-right">Acções</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className="border-b border-slate-50">
                    <td className="px-3 py-2">{rowPreview(row, previewKeys) || String(row.id).slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                        onClick={() => void remove(String(row.id), rowPreview(row, previewKeys) || 'registo')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`Novo — ${config.title}`} panelClassName="max-w-xl" scrollBody>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          {config.fields.map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm text-slate-600">
                {field.label}
                {field.required ? ' *' : ''}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  className="input min-h-[80px]"
                  value={String(form[field.key] ?? '')}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  required={field.required}
                />
              ) : field.type === 'select' ? (
                <select
                  className="input"
                  value={String(form[field.key] ?? '')}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  required={field.required}
                >
                  <option value="">Seleccionar…</option>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : field.type === 'boolean' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(form[field.key])}
                    onChange={(e) => setForm({ ...form, [field.key]: e.target.checked })}
                  />
                  Sim
                </label>
              ) : (
                <input
                  className="input"
                  type={field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'decimal' ? 'number' : 'text'}
                  step={field.type === 'decimal' ? '0.01' : undefined}
                  value={String(form[field.key] ?? '')}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  required={field.required}
                />
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'A guardar…' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </>
  );
}

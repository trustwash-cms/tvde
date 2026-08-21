'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  API_PATHS,
  getRoleLabel,
  type Role,
  type UserDocumentItem,
  type UserProfileDetail,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import { UserDocumentsSection } from '@/components/users/user-documents-section';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import type { UserListItem } from '@/components/users/user-list-card';

function emptyProfileForm(detail: UserProfileDetail | null) {
  return {
    fullName: detail?.user.fullName ?? '',
    nif: detail?.profile?.nif ?? '',
    ccAutorizacaoResidencia: detail?.profile?.ccAutorizacaoResidencia ?? '',
    numeroOperadorTvde: detail?.profile?.numeroOperadorTvde ?? '',
    distrito: detail?.profile?.distrito ?? '',
    concelho: detail?.profile?.concelho ?? '',
    localidade: detail?.profile?.localidade ?? '',
    arruamento: detail?.profile?.arruamento ?? '',
    numeroPorta: detail?.profile?.numeroPorta ?? '',
    codigoPostal: detail?.profile?.codigoPostal ?? '',
  };
}

export function UserDetailsModal({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: UserListItem | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<UserProfileDetail | null>(null);
  const [documents, setDocuments] = useState<UserDocumentItem[]>([]);
  const [form, setForm] = useState(emptyProfileForm(null));

  useEffect(() => {
    if (!open || !user) return;

    setLoading(true);
    setError('');
    setDetail(null);

    apiFetch<UserProfileDetail>(API_PATHS.users.profile(user.id)).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setDetail(res.data);
        setDocuments(res.data.documents);
        setForm(emptyProfileForm(res.data));
        return;
      }
      setError(getApiErrorMessage(res));
    });
  }, [open, user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;

    setSubmitting(true);
    setError('');

    const res = await apiFetch<UserProfileDetail>(API_PATHS.users.profile(user.id), {
      method: 'PATCH',
      body: JSON.stringify(form),
    });

    setSubmitting(false);

    if (res.success && res.data) {
      setDetail(res.data);
      setDocuments(res.data.documents);
      onSaved?.();
      onClose();
      return;
    }

    setError(getApiErrorMessage(res));
  }

  const displayName = detail?.user.username ?? user?.username ?? user?.email?.split('@')[0] ?? '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `Detalhes — ${displayName}` : 'Detalhes'}
      panelClassName="max-w-2xl"
      scrollBody
      showCloseButton
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Fechar
          </button>
          <button
            type="submit"
            form="user-details-form"
            className="btn-primary"
            disabled={loading || submitting || !user}
          >
            {submitting ? 'A guardar…' : 'Guardar detalhes'}
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-slate-500">A carregar…</p>
      ) : error && !detail ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : detail && user ? (
        <form id="user-details-form" onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p>
                <span className="text-slate-500">Email:</span>{' '}
                <span className="font-medium text-slate-800">{detail.user.email}</span>
              </p>
              <p>
                <span className="text-slate-500">Role:</span>{' '}
                <span className="font-medium text-slate-800">{getRoleLabel(detail.user.role as Role)}</span>
              </p>
              {detail.user.phone ? (
                <p>
                  <span className="text-slate-500">Telefone:</span>{' '}
                  <span className="font-medium text-slate-800">{detail.user.phone}</span>
                </p>
              ) : null}
              {detail.user.tenant ? (
                <p>
                  <span className="text-slate-500">Site ID:</span>{' '}
                  <span className="font-medium text-slate-800">{detail.user.tenant.siteId}</span>
                </p>
              ) : null}
            </div>
          </section>

          <section className="space-y-4">
            <h4 className="text-sm font-semibold text-slate-800">Identificação</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Nome completo</label>
                <input
                  className="input"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">NIF</label>
                <input
                  className="input"
                  value={form.nif}
                  onChange={(e) => setForm({ ...form, nif: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  CC / Autorização de residência
                </label>
                <input
                  className="input"
                  value={form.ccAutorizacaoResidencia}
                  onChange={(e) => setForm({ ...form, ccAutorizacaoResidencia: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Certificado CMTVDE (n.º operador)
                </label>
                <input
                  className="input"
                  value={form.numeroOperadorTvde}
                  onChange={(e) => setForm({ ...form, numeroOperadorTvde: e.target.value })}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h4 className="text-sm font-semibold text-slate-800">Morada</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Distrito</label>
                <input
                  className="input"
                  value={form.distrito}
                  onChange={(e) => setForm({ ...form, distrito: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Concelho</label>
                <input
                  className="input"
                  value={form.concelho}
                  onChange={(e) => setForm({ ...form, concelho: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Localidade</label>
                <input
                  className="input"
                  value={form.localidade}
                  onChange={(e) => setForm({ ...form, localidade: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Código postal</label>
                <input
                  className="input"
                  value={form.codigoPostal}
                  onChange={(e) => setForm({ ...form, codigoPostal: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Arruamento</label>
                <input
                  className="input"
                  value={form.arruamento}
                  onChange={(e) => setForm({ ...form, arruamento: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">N.º porta</label>
                <input
                  className="input"
                  value={form.numeroPorta}
                  onChange={(e) => setForm({ ...form, numeroPorta: e.target.value })}
                />
              </div>
            </div>
          </section>

          <UserDocumentsSection
            userId={user.id}
            documents={documents}
            onDocumentsChange={setDocuments}
            canUpload
            canDelete
          />

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </form>
      ) : null}
    </Modal>
  );
}

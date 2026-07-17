'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import type { UserListItem } from '@/components/users/user-list-card';

function displayName(user: UserListItem): string {
  return user.username ?? user.email.split('@')[0] ?? user.email;
}

export function DeleteUserModal({
  open,
  user,
  onClose,
  onRequestCode,
  onConfirmDelete,
}: {
  open: boolean;
  user: UserListItem | null;
  onClose: () => void;
  onRequestCode: (userId: string) => Promise<{ maskedEmail?: string } | null>;
  onConfirmDelete: (userId: string, confirmationCode: string) => Promise<boolean>;
}) {
  const [confirmationCode, setConfirmationCode] = useState('');
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const [codeSending, setCodeSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setConfirmationCode('');
    setCodeHint(null);
    setCodeSent(false);
    setError('');
    void requestCode(user.id);
  }, [open, user?.id]);

  async function requestCode(userId: string) {
    setCodeSending(true);
    setError('');
    const result = await onRequestCode(userId);
    setCodeSending(false);
    if (result) {
      setCodeSent(true);
      if (result.maskedEmail) setCodeHint(result.maskedEmail);
    } else {
      setError('Não foi possível enviar o código de confirmação.');
    }
  }

  async function handleDelete() {
    if (!user) return;
    setDeleting(true);
    setError('');
    const ok = await onConfirmDelete(user.id, confirmationCode.trim());
    setDeleting(false);
    if (ok) onClose();
    else setError('Não foi possível eliminar o utilizador. Verifique o código.');
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Eliminar utilizador"
      panelClassName="max-w-md"
      scrollBody
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={deleting}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!user || deleting || confirmationCode.trim().length !== 6 || !codeSent}
            onClick={handleDelete}
          >
            {deleting ? 'A eliminar…' : 'Eliminar definitivamente'}
          </button>
        </div>
      }
    >
      {user ? (
        <>
          <p className="text-sm text-slate-600">
            Esta acção é irreversível. O utilizador{' '}
            <strong>{displayName(user)}</strong> ({user.email}) será eliminado permanentemente.
          </p>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-medium text-slate-700">Confirmação por email</p>
            <p className="mt-1 text-xs text-slate-500">
              {codeSending
                ? 'A enviar código…'
                : codeSent && codeHint
                  ? `Código enviado para ${codeHint}. Válido 10 minutos.`
                  : 'Será enviado um código para o seu email.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="input max-w-[10rem]"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Código 6 dígitos"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={codeSending}
                onClick={() => requestCode(user.id)}
              >
                {codeSending ? 'A enviar…' : 'Reenviar código'}
              </button>
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </>
      ) : null}
    </Modal>
  );
}

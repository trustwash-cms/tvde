'use client';

import {
  Car,
  Globe,
  Info,
  Key,
  Mail,
  BookOpen,
  SquarePen,
  ToggleLeft,
  ToggleRight,
  Trash2,
  UserRoundSearch,
} from 'lucide-react';
import clsx from 'clsx';
import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';

export interface UserListItem {
  id: string;
  email: string;
  username?: string | null;
  fullName?: string | null;
  phone?: string | null;
  role: string;
  status: string;
  mustChangePassword?: boolean;
  lastLoginAt: string | null;
  tenant?: { id: string; siteId: string; name: string } | null;
}

function displayName(user: UserListItem): string {
  if (user.username) return user.username;
  return user.email.split('@')[0] ?? user.email;
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'active':
      return { label: 'Active', className: 'bg-emerald-500 text-white' };
    case 'pending':
      return { label: 'Pending', className: 'bg-amber-500 text-white' };
    case 'suspended':
      return { label: 'Suspended', className: 'bg-red-500 text-white' };
    default:
      return { label: status, className: 'bg-slate-400 text-white' };
  }
}

function ActionIconButton({
  label,
  onClick,
  className,
  children,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'rounded-md p-1.5 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35',
        className
      )}
    >
      {children}
    </button>
  );
}

export function UserListCard({
  user,
  canEdit,
  canDelete,
  canToggle,
  canDetails,
  canVehicles,
  canImpersonate,
  canContaCorrente,
  canCredentialsAction,
  credentialsBusy,
  onEdit,
  onDelete,
  onToggleStatus,
  onDetails,
  onVehicles,
  onImpersonate,
  onCredentialsAction,
}: {
  user: UserListItem;
  canEdit?: boolean;
  canDelete?: boolean;
  canToggle?: boolean;
  canDetails?: boolean;
  canVehicles?: boolean;
  canImpersonate?: boolean;
  canContaCorrente?: boolean;
  canCredentialsAction?: boolean;
  credentialsBusy?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleStatus?: () => void;
  onDetails?: () => void;
  onVehicles?: () => void;
  onImpersonate?: () => void;
  onCredentialsAction?: () => void;
}) {
  const isActive = user.status === 'active';
  const isPending = user.status === 'pending';
  const siteId = user.tenant?.siteId;
  const badge = statusBadge(user.status);
  const keyLabel = isPending
    ? 'Reenviar credenciais'
    : isActive
      ? 'Reset password'
      : 'Credenciais indisponíveis';

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-slate-900">{displayName(user)}</h3>
        <div className="mt-2 space-y-1 text-sm text-slate-500">
          <p className="flex items-center gap-2 truncate">
            <Mail size={14} className="shrink-0 text-slate-400" />
            <span className="truncate">{user.email}</span>
          </p>
          {siteId ? (
            <p className="flex items-center gap-2">
              <Globe size={14} className="shrink-0 text-slate-400" />
              <span>Site ID: {siteId}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
        <span
          className={clsx(
            'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
            badge.className
          )}
        >
          {badge.label}
        </span>

        {canDetails !== false ? (
          <button
            type="button"
            title="Details"
            aria-label="Details"
            disabled={!onDetails}
            onClick={onDetails}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Info size={15} />
            Details
          </button>
        ) : null}

        {canImpersonate ? (
          <button
            type="button"
            title="Personificar"
            aria-label="Personificar"
            disabled={!onImpersonate}
            onClick={onImpersonate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <UserRoundSearch size={15} />
            Personificar
          </button>
        ) : null}

        <ActionIconButton
          label="Editar"
          onClick={canEdit ? onEdit : undefined}
          disabled={!canEdit}
          className="text-sky-600"
        >
          <SquarePen size={18} />
        </ActionIconButton>
        <ActionIconButton
          label="Viatura"
          onClick={canVehicles !== false ? onVehicles : undefined}
          disabled={canVehicles === false || !onVehicles}
          className="text-slate-500"
        >
          <Car size={18} />
        </ActionIconButton>
        {canContaCorrente && user.role === 'admin' ? (
          <Link
            href={`${WEB_ROUTES.dashboard.contaCorrente.root}?driverId=${encodeURIComponent(user.id)}`}
            title="Conta corrente"
            aria-label="Conta corrente"
            className="rounded-md p-1.5 text-indigo-600 transition hover:bg-indigo-50"
          >
            <BookOpen size={18} />
          </Link>
        ) : null}
        <ActionIconButton
          label={credentialsBusy ? 'A processar…' : keyLabel}
          onClick={canCredentialsAction ? onCredentialsAction : undefined}
          disabled={!canCredentialsAction || credentialsBusy}
          className={isPending ? 'text-amber-600' : 'text-violet-600'}
        >
          <Key size={18} />
        </ActionIconButton>
        <ActionIconButton
          label="Eliminar"
          onClick={canDelete ? onDelete : undefined}
          disabled={!canDelete}
          className="text-red-500 hover:bg-red-50"
        >
          <Trash2 size={18} />
        </ActionIconButton>
        {canToggle ? (
          <ActionIconButton
            label={isActive ? 'Desactivar' : 'Activar'}
            onClick={onToggleStatus}
            className={isActive ? 'text-amber-500' : 'text-emerald-600'}
          >
            {isActive ? <ToggleRight size={22} strokeWidth={2.25} /> : <ToggleLeft size={22} strokeWidth={2.25} />}
          </ActionIconButton>
        ) : null}
      </div>
    </article>
  );
}

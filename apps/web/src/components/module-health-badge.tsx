import clsx from 'clsx';

export type ModuleHealthStatus = 'core' | 'ok' | 'warning' | 'error' | 'inactive';

const STYLES: Record<ModuleHealthStatus, string> = {
  core: 'bg-slate-100 text-slate-600 border-slate-200',
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  inactive: 'bg-slate-50 text-slate-400 border-slate-200',
};

const DOT: Record<ModuleHealthStatus, string> = {
  core: 'bg-slate-400',
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  inactive: 'bg-slate-300',
};

export function ModuleHealthBadge({
  status,
  label,
  title,
}: {
  status: ModuleHealthStatus;
  label: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        STYLES[status]
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', DOT[status])} aria-hidden />
      {label}
    </span>
  );
}

'use client';

interface MoloniConnectionIndicatorProps {
  healthy: boolean | null | undefined;
  statusMessage?: string;
  checking?: boolean;
  size?: 'sm' | 'md';
}

export function MoloniConnectionIndicator({
  healthy,
  statusMessage,
  checking = false,
  size = 'md',
}: MoloniConnectionIndicatorProps) {
  const dotSize = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';

  let dotClass = 'bg-slate-300';
  if (checking) {
    dotClass = 'bg-slate-300 animate-pulse';
  } else if (healthy === true) {
    dotClass = 'bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.25)]';
  } else if (healthy === false) {
    dotClass = 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.25)]';
  }

  const label =
    statusMessage ??
    (checking ? 'A verificar…' : healthy ? 'Comunicação OK' : 'Sem ligação');

  return (
    <span
      className="inline-flex items-center gap-2"
      title={label}
      role="status"
      aria-label={`Moloni: ${label}`}
    >
      <span className={`inline-block shrink-0 rounded-full ${dotSize} ${dotClass}`} />
      <span className={`text-slate-500 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>{label}</span>
    </span>
  );
}

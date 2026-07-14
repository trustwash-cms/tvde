'use client';

import type { WorkspaceOption } from '@/hooks/use-workspace-context';

interface WorkspaceSelectorProps {
  workspaces: WorkspaceOption[];
  workspaceId: string | null;
  onChange: (id: string) => void;
  className?: string;
}

/** Alinha botões/links à base do select do workspace (não ao centro do label). */
export function WorkspaceSelectorRow({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`flex flex-wrap items-end gap-2 ${className}`.trim()}>{children}</div>;
}

export function WorkspaceSelector({
  workspaces,
  workspaceId,
  onChange,
  className = '',
}: WorkspaceSelectorProps) {
  if (workspaces.length <= 1) return null;

  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="font-medium text-slate-700">Workspace</span>
      <select
        className="input max-w-md"
        value={workspaceId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required
      >
        <option value="" disabled>
          Seleccionar workspace…
        </option>
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.tenant ? `${ws.tenant.name} — ` : ''}
            {ws.name} ({ws.slug})
          </option>
        ))}
      </select>
    </label>
  );
}

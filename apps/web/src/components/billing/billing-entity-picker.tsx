'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface BillingEntityOption {
  id: string;
  name: string;
  vat: string | null;
  linkStatus?: string;
}

function entityLabel(e: BillingEntityOption): string {
  const parts = [e.name];
  if (e.vat) parts.push(e.vat);
  if (e.linkStatus === 'pending_confirm') parts.push('(confirmar NIF)');
  if (e.linkStatus === 'conflict') parts.push('(conflito)');
  return parts.join(' · ');
}

export function BillingEntityPicker({
  entities,
  value,
  onChange,
  pinnedEntity,
  disabled,
  required,
  theme = 'light',
}: {
  entities: BillingEntityOption[];
  value: string;
  onChange: (id: string) => void;
  /** Entidade acabada de criar — mostra selecção antes do reload da lista */
  pinnedEntity?: BillingEntityOption | null;
  disabled?: boolean;
  /** @deprecated validação feita no formulário pai */
  required?: boolean;
  theme?: 'light' | 'dark';
}) {
  const dark = theme === 'dark';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selected =
    entities.find((e) => e.id === value) ??
    (pinnedEntity?.id === value ? pinnedEntity : undefined);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.vat?.toLowerCase().includes(q) ?? false)
    );
  }, [entities, search]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function clearSelection() {
    onChange('');
    setSearch('');
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="space-y-2">
      {selected && value && (
        <div
          className={
            dark
              ? 'flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100'
              : 'flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900'
          }
        >
          <span className="min-w-0 truncate">
            Cliente seleccionado: <span className="font-medium">{entityLabel(selected)}</span>
          </span>
          <button
            type="button"
            className={
              dark
                ? 'shrink-0 rounded p-1 text-emerald-200 hover:bg-emerald-900/40'
                : 'shrink-0 rounded p-1 text-green-800 hover:bg-green-100'
            }
            title="Remover selecção"
            onClick={clearSelection}
            disabled={disabled}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="relative">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            className="input pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={
              selected ? 'Pesquisar outro cliente…' : 'Pesquisar cliente (nome ou NIF)…'
            }
            disabled={disabled}
            autoComplete="off"
          />
        </div>

        {open && !disabled && (
          <ul
            className={
              dark
                ? 'absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-lg'
                : 'absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg'
            }
          >
            {filtered.length === 0 ? (
              <li className={`px-3 py-2 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Sem resultados
              </li>
            ) : (
              filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={
                      dark
                        ? `w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 ${
                            e.id === value ? 'bg-blue-950/50 text-blue-200' : ''
                          }`
                        : `w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                            e.id === value
                              ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                              : ''
                          }`
                    }
                    onClick={() => {
                      onChange(e.id);
                      setSearch('');
                      setOpen(false);
                    }}
                  >
                    {entityLabel(e)}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

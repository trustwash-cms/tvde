'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface SearchableComboboxOption {
  id: string;
  label: string;
  /** Texto extra para filtrar (ex. matrícula, NIF) */
  keywords?: string;
}

export function SearchableCombobox({
  options,
  value,
  onChange,
  placeholder = 'Pesquisar…',
  disabled,
  emptyMessage = 'Sem resultados',
  showSelectedChip = false,
}: {
  options: SearchableComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyMessage?: string;
  /** Mostra chip com selecção actual (útil em formulários largos) */
  showSelectedChip?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.keywords ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, search]);

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
    <div ref={rootRef} className="min-w-0 flex-1 space-y-2">
      {showSelectedChip && selected && value && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          <span className="min-w-0 truncate font-medium">{selected.label}</span>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-green-800 hover:bg-green-100"
            title="Limpar selecção"
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
            className="input w-full pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={selected && value ? `${selected.label} — pesquisar outro…` : placeholder}
            disabled={disabled}
            autoComplete="off"
          />
        </div>

        {open && !disabled && (
          <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <li>
              <button
                type="button"
                className={`w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 ${
                  !value ? 'bg-slate-50 font-medium' : ''
                }`}
                onClick={() => {
                  onChange('');
                  setSearch('');
                  setOpen(false);
                }}
              >
                —
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">{emptyMessage}</li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      o.id === value
                        ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                        : ''
                    }`}
                    onClick={() => {
                      onChange(o.id);
                      setSearch('');
                      setOpen(false);
                    }}
                  >
                    {o.label}
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

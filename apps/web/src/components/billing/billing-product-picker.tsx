'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export interface BillingProductOption {
  productId: number;
  name: string;
  price: number | null;
  reference: string | null;
}

function productLabel(p: BillingProductOption): string {
  const parts = [p.name];
  if (p.reference) parts.push(p.reference);
  if (p.price != null) parts.push(`${p.price.toFixed(2)} €`);
  return parts.join(' · ');
}

export function BillingProductPicker({
  products,
  loading,
  onSearch,
  onSelect,
  disabled,
  theme = 'light',
}: {
  products: BillingProductOption[];
  loading?: boolean;
  onSearch: (q: string) => void;
  onSelect: (product: BillingProductOption) => void;
  disabled?: boolean;
  theme?: 'light' | 'dark';
}) {
  const dark = theme === 'dark';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.reference?.toLowerCase().includes(q) ?? false)
    );
  }, [products, search]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={rootRef} className="relative">
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
            onSearch(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Pesquisar por nome ou Ref.ª Artigo…"
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
          {loading ? (
            <li className={`px-3 py-2 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              A carregar artigos…
            </li>
          ) : !search.trim() ? (
            <li className={`px-3 py-2 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              Escreva para pesquisar no catálogo Moloni…
            </li>
          ) : filtered.length === 0 ? (
            <li className={`px-3 py-2 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              Sem resultados — tente outra pesquisa
            </li>
          ) : (
            filtered.map((p) => (
              <li key={p.productId}>
                <button
                  type="button"
                  className={
                    dark
                      ? 'w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800'
                      : 'w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50'
                  }
                  onClick={() => {
                    onSelect(p);
                    setSearch('');
                    setOpen(false);
                  }}
                >
                  {productLabel(p)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

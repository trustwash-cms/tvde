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
}: {
  products: BillingProductOption[];
  loading?: boolean;
  onSearch: (q: string) => void;
  onSelect: (product: BillingProductOption) => void;
  disabled?: boolean;
}) {
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
          placeholder="Pesquisar em artigos…"
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading ? (
            <li className="px-3 py-2 text-sm text-slate-500">A carregar artigos…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">Sem artigos — sincronize no Moloni</li>
          ) : (
            filtered.map((p) => (
              <li key={p.productId}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
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

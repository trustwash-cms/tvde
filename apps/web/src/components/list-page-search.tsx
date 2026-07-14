'use client';

import { FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useListSearch } from '@/lib/list-search';

interface ListPageSearchProps {
  placeholder?: string;
}

export default function ListPageSearch({
  placeholder = 'Pesquisar… (mín. 2 caracteres)',
}: ListPageSearchProps) {
  const { q, input, setInput, applySearch } = useListSearch();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    applySearch(input);
  }

  return (
    <form onSubmit={handleSubmit} className="relative mb-6 max-w-md">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="input pl-9 pr-9"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
      />
      {(input || q) && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          onClick={() => {
            setInput('');
            applySearch('');
          }}
          aria-label="Limpar pesquisa"
        >
          <X size={14} />
        </button>
      )}
      {q && (
        <p className="mt-1.5 text-xs text-slate-500">
          Filtro activo: <span className="font-medium">&quot;{q}&quot;</span>
        </p>
      )}
    </form>
  );
}

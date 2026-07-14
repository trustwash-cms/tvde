'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import {
  getSearchResultHref,
  SEARCH_TYPE_LABELS,
  type SearchResult,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

const DEBOUNCE_MS = 300;
const MIN_LENGTH = 2;

type DashboardGlobalSearchProps = {
  showClients?: boolean;
};

export default function DashboardGlobalSearch({
  showClients = false,
}: DashboardGlobalSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch<{ query: string; results: SearchResult[] }>(
        `${API_PATHS.search.global}?q=${encodeURIComponent(trimmed)}`,
        {},
        getStoredToken()
      ).then((res) => {
        if (res.success && res.data) setResults(res.data.results);
        else setResults([]);
        setLoading(false);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function navigate(result: SearchResult) {
    const href = getSearchResultHref(result, query);
    setOpen(false);
    setQuery('');
    setResults([]);
    router.push(href);
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  const searchScope = ['tenants', 'workspaces', 'utilizadores'];
  if (showClients) searchScope.splice(2, 0, 'clientes');

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          className="input w-full pl-9"
          placeholder={`Pesquisa global — ${searchScope.join(', ')}…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>

      {open && query.trim().length >= MIN_LENGTH && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(24rem,70vh)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 shadow-lg">
          {loading && (
            <p className="px-4 py-3 text-sm text-slate-400">A pesquisar…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">Sem resultados</p>
          )}
          {!loading &&
            Object.entries(grouped).map(([type, items]) => (
              <div key={type} className="py-1">
                <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {SEARCH_TYPE_LABELS[type as SearchResult['type']]}
                </p>
                {items.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    className="flex w-full flex-col px-4 py-2 text-left hover:bg-slate-50"
                    onClick={() => navigate(item)}
                  >
                    <span className="text-sm font-medium text-slate-800">{item.title}</span>
                    {item.subtitle && (
                      <span className="text-xs text-slate-500">{item.subtitle}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

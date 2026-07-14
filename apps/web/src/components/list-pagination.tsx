'use client';

interface ListPaginationProps {
  page: number;
  limit: number;
  total: number;
  limits?: number[];
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export function ListPagination({
  page,
  limit,
  total,
  limits = [10, 20, 50],
  onPageChange,
  onLimitChange,
}: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : page * limit + 1;
  const to = Math.min(total, (page + 1) * limit);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm text-slate-600">
      <div className="flex items-center gap-2">
        <span>Mostrar</span>
        <select
          className="input w-auto py-1.5 text-sm"
          value={limit}
          onChange={(e) => {
            onLimitChange(Number(e.target.value));
            onPageChange(0);
          }}
        >
          {limits.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span>por página</span>
      </div>

      <span>
        {from}–{to} de {total}
      </span>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-sm"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-sm"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Seguinte
        </button>
      </div>
    </div>
  );
}

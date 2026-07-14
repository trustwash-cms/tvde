'use client';

export function ModuleInactiveMessage({ moduleLabel }: { moduleLabel?: string }) {
  return (
    <div className="flex min-h-[min(420px,50vh)] items-center justify-center px-4 py-12">
      <div className="card max-w-md text-center shadow-sm">
        <p className="text-base font-semibold text-slate-900">
          {moduleLabel
            ? `O módulo «${moduleLabel}» não está activo para o seu utilizador`
            : 'Este módulo não está activo para o seu utilizador'}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          Por favor contacte o administrador da sua conta.
        </p>
      </div>
    </div>
  );
}

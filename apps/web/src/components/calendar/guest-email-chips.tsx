'use client';

import { KeyboardEvent, useState } from 'react';
import { X } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normalizeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }
  return result;
}

export function GuestEmailChips({
  emails,
  onChange,
  placeholder = 'email@exemplo.com',
}: {
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const parts = raw.split(/[,;\s]+/).filter(Boolean);
    if (parts.length === 0) return;
    onChange(normalizeEmails([...emails, ...parts]));
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && emails.length > 0) {
      onChange(emails.slice(0, -1));
    }
  }

  function remove(email: string) {
    onChange(emails.filter((e) => e !== email));
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)]">
      <div className="flex flex-wrap gap-1.5">
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--color-primary-light)] px-2 py-0.5 text-xs text-[var(--color-primary)]"
          >
            <span className="truncate">{email}</span>
            <button
              type="button"
              className="shrink-0 rounded-full p-0.5 hover:bg-white/60"
              onClick={() => remove(email)}
              aria-label={`Remover ${email}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          className="min-w-[8rem] flex-1 border-0 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400"
          placeholder={emails.length === 0 ? placeholder : 'Adicionar…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">Enter ou vírgula para adicionar</p>
    </div>
  );
}

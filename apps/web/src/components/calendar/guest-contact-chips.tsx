'use client';

import { KeyboardEvent, useState } from 'react';
import { Phone, X } from 'lucide-react';
import { formatDisplayPhone } from '@/lib/phone-format';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_INPUT_RE = /^[+]?[\d\s().-]{8,}$/;

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;
  return email;
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !PHONE_INPUT_RE.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (trimmed.startsWith('+')) return formatDisplayPhone(trimmed) || null;
  if (digits.length === 9 && /^[29]/.test(digits)) {
    return formatDisplayPhone(`+351${digits}`) || `+351 ${digits}`;
  }
  return `+${digits}`;
}

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function GuestContactChips({
  emails,
  phones,
  onChange,
  placeholder = 'Email ou telefone do convidado',
}: {
  emails: string[];
  phones: string[];
  onChange: (value: { emails: string[]; phones: string[] }) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const parts = raw.split(/[,;\s]+/).filter(Boolean);
    if (parts.length === 0) return;

    let nextEmails = [...emails];
    let nextPhones = [...phones];
    const emailSeen = new Set(nextEmails);
    const phoneSeen = new Set(nextPhones.map(phoneKey));

    for (const part of parts) {
      const email = normalizeEmail(part);
      if (email) {
        if (!emailSeen.has(email)) {
          emailSeen.add(email);
          nextEmails.push(email);
        }
        continue;
      }

      const phone = normalizePhone(part);
      if (phone) {
        const key = phoneKey(phone);
        if (!phoneSeen.has(key)) {
          phoneSeen.add(key);
          nextPhones.push(phone);
        }
      }
    }

    onChange({ emails: nextEmails, phones: nextPhones });
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && (emails.length > 0 || phones.length > 0)) {
      if (phones.length > 0) {
        onChange({ emails, phones: phones.slice(0, -1) });
      } else {
        onChange({ emails: emails.slice(0, -1), phones });
      }
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)]">
      <div className="flex flex-wrap gap-1.5">
        {emails.map((email) => (
          <span
            key={`email-${email}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--color-primary-light)] px-2 py-0.5 text-xs text-[var(--color-primary)]"
          >
            <span className="truncate">{email}</span>
            <button
              type="button"
              className="shrink-0 rounded-full p-0.5 hover:bg-white/60"
              onClick={() => onChange({ emails: emails.filter((e) => e !== email), phones })}
              aria-label={`Remover ${email}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {phones.map((phone) => (
          <span
            key={`phone-${phoneKey(phone)}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-800"
          >
            <Phone size={11} className="shrink-0" />
            <span className="truncate">{formatDisplayPhone(phone)}</span>
            <button
              type="button"
              className="shrink-0 rounded-full p-0.5 hover:bg-white/60"
              onClick={() =>
                onChange({
                  emails,
                  phones: phones.filter((p) => phoneKey(p) !== phoneKey(phone)),
                })
              }
              aria-label={`Remover ${phone}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          className="min-w-[10rem] flex-1 border-0 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400"
          placeholder={emails.length + phones.length === 0 ? placeholder : 'Adicionar…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        Enter ou vírgula · aceita email ou telefone (+351…)
      </p>
    </div>
  );
}

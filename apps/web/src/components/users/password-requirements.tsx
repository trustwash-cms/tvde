'use client';

import { Check, X } from 'lucide-react';
import { getPasswordRequirementChecks } from '@tvde/shared';
import clsx from 'clsx';

export function PasswordRequirements({ password }: { password: string }) {
  const checks = getPasswordRequirementChecks(password);

  return (
    <ul className="space-y-1">
      {checks.map((check) => (
        <li
          key={check.id}
          className={clsx(
            'flex items-center gap-2 text-xs',
            check.ok ? 'text-emerald-600' : 'text-slate-500'
          )}
        >
          {check.ok ? <Check size={14} className="shrink-0" /> : <X size={14} className="shrink-0 text-red-400" />}
          {check.label}
        </li>
      ))}
    </ul>
  );
}

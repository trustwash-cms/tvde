'use client';

import { useState } from 'react';

export const FINAL_CONSUMER_VAT = '999999990';

export const MOLONI_COUNTRIES = [
  { id: 1, label: 'Portugal' },
  { id: 2, label: 'Espanha' },
  { id: 3, label: 'França' },
  { id: 4, label: 'Alemanha' },
  { id: 5, label: 'Itália' },
  { id: 6, label: 'Reino Unido' },
  { id: 7, label: 'Brasil' },
] as const;

export interface BillingEntityFormValues {
  name: string;
  vat: string;
  finalConsumer: boolean;
  address: string;
  zipCode: string;
  city: string;
  countryId: number;
  email: string;
  phone: string;
}

export const emptyEntityForm = (): BillingEntityFormValues => ({
  name: '',
  vat: '',
  finalConsumer: false,
  address: '',
  zipCode: '',
  city: '',
  countryId: 1,
  email: '',
  phone: '',
});

export function entityFormFromRecord(entity: {
  name: string;
  vat: string | null;
  email: string | null;
  phone: string | null;
  addressJson?: unknown;
}): BillingEntityFormValues {
  const addr = (entity.addressJson ?? {}) as {
    address?: string;
    city?: string;
    zipCode?: string;
    countryId?: number;
  };
  const vat = entity.vat ?? '';
  return {
    name: entity.name,
    vat,
    finalConsumer: vat === FINAL_CONSUMER_VAT,
    address: addr.address ?? '',
    zipCode: addr.zipCode ?? '',
    city: addr.city ?? '',
    countryId: addr.countryId ?? 1,
    email: entity.email ?? '',
    phone: entity.phone ?? '',
  };
}

export function billingEntityFormPayload(
  form: BillingEntityFormValues,
  entityType: 'customer' | 'supplier'
) {
  const vat = (form.finalConsumer ? FINAL_CONSUMER_VAT : form.vat.replace(/\s/g, '')).toUpperCase();
  return {
    entityType,
    name: form.name.trim(),
    vat,
    isFinalConsumer: form.finalConsumer,
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    address: form.address.trim() || undefined,
    city: form.city.trim() || undefined,
    zipCode: form.zipCode.trim() || undefined,
    countryId: form.countryId,
  };
}

export function validateEntityForm(form: BillingEntityFormValues): string | null {
  if (!form.name.trim()) return 'Nome obrigatório';
  const vat = form.finalConsumer ? FINAL_CONSUMER_VAT : form.vat.replace(/\s/g, '');
  if (!vat) return 'NIF obrigatório';
  if (vat === FINAL_CONSUMER_VAT && !form.finalConsumer) {
    return 'Marque «Consumidor final» ou introduza outro NIF';
  }
  if (!form.city.trim()) return 'Localidade obrigatória';
  return null;
}

type FormTab = 'geral' | 'contactos';

export function BillingEntityFormFields({
  form,
  onChange,
  vatReadOnly,
  disabled,
}: {
  form: BillingEntityFormValues;
  onChange: (next: BillingEntityFormValues) => void;
  vatReadOnly?: boolean;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<FormTab>('geral');

  function applyFinalConsumer(checked: boolean) {
    onChange({
      ...form,
      finalConsumer: checked,
      vat: checked ? FINAL_CONSUMER_VAT : form.vat === FINAL_CONSUMER_VAT ? '' : form.vat,
      name: checked && !form.name.trim() ? 'Consumidor Final' : form.name,
    });
  }

  function onVatChange(raw: string) {
    const vat = raw.replace(/\s/g, '');
    onChange({
      ...form,
      vat: raw,
      finalConsumer: vat === FINAL_CONSUMER_VAT ? form.finalConsumer : false,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ['geral', 'Geral'],
            ['contactos', 'Contactos'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`px-3 py-2 text-sm font-medium ${
              tab === id
                ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'geral' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.finalConsumer}
              onChange={(e) => applyFinalConsumer(e.target.checked)}
              disabled={disabled || vatReadOnly}
            />
            Consumidor final (NIF {FINAL_CONSUMER_VAT})
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              NIF / Contribuinte <span className="text-red-500">*</span>
            </label>
            <input
              className="input"
              value={form.vat}
              onChange={(e) => onVatChange(e.target.value)}
              readOnly={form.finalConsumer || vatReadOnly}
              disabled={disabled || form.finalConsumer || vatReadOnly}
              placeholder="NIF"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              disabled={disabled}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Morada</label>
            <input
              className="input"
              value={form.address}
              onChange={(e) => onChange({ ...form, address: e.target.value })}
              disabled={disabled}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Código postal</label>
            <input
              className="input"
              value={form.zipCode}
              onChange={(e) => onChange({ ...form, zipCode: e.target.value })}
              placeholder="0000-000"
              disabled={disabled}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Localidade <span className="text-red-500">*</span>
            </label>
            <input
              className="input"
              value={form.city}
              onChange={(e) => onChange({ ...form, city: e.target.value })}
              disabled={disabled}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">
              País <span className="text-red-500">*</span>
            </label>
            <select
              className="input"
              value={form.countryId}
              onChange={(e) => onChange({ ...form, countryId: Number(e.target.value) })}
              disabled={disabled}
            >
              {MOLONI_COUNTRIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {tab === 'contactos' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => onChange({ ...form, email: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Telefone</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => onChange({ ...form, phone: e.target.value.replace(/\./g, ' ') })}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}

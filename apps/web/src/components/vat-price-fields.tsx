'use client';

import {
  getTaxRateById,
  priceExVatToIncVat,
  priceIncVatToExVat,
  formatExVatInput,
  formatVatPriceInput,
  type VatTaxRate,
} from '@tvde/shared';

export interface VatPriceValues {
  taxId: string;
  priceExVat: string;
  priceIncVat: string;
}

interface VatPriceFieldsProps {
  taxes: VatTaxRate[];
  taxId: string | number;
  priceExVat: string;
  priceIncVat: string;
  onChange: (values: VatPriceValues) => void;
  required?: boolean;
  inputClassName?: string;
  labelClassName?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function VatPriceFields({
  taxes,
  taxId,
  priceExVat,
  priceIncVat,
  onChange,
  required = false,
  inputClassName = 'input',
  labelClassName = 'mb-1 block text-sm text-slate-600',
  disabled = false,
  compact = false,
}: VatPriceFieldsProps) {
  const taxIdStr = String(taxId);
  const rate = getTaxRateById(taxes, Number(taxIdStr));

  function emit(patch: Partial<VatPriceValues>) {
    onChange({
      taxId: taxIdStr,
      priceExVat,
      priceIncVat,
      ...patch,
    });
  }

  function handleExChange(value: string) {
    if (value === '') {
      emit({ priceExVat: '', priceIncVat: '' });
      return;
    }
    const ex = Number(value);
    if (!Number.isFinite(ex)) return;
    emit({ priceExVat: value, priceIncVat: formatVatPriceInput(priceExVatToIncVat(ex, rate)) });
  }

  function handleIncChange(value: string) {
    if (value === '') {
      emit({ priceExVat: '', priceIncVat: '' });
      return;
    }
    const inc = Number(value);
    if (!Number.isFinite(inc)) return;
    emit({ priceExVat: formatExVatInput(priceIncVatToExVat(inc, rate)), priceIncVat: value });
  }

  function handleIncBlur() {
    if (priceIncVat === '') return;
    const inc = Number(priceIncVat);
    if (!Number.isFinite(inc)) return;
    emit({ priceIncVat: formatVatPriceInput(inc) });
  }

  function handleTaxChange(value: string) {
    const newRate = getTaxRateById(taxes, Number(value));
    if (priceExVat !== '') {
      const ex = Number(priceExVat);
      if (Number.isFinite(ex)) {
        emit({
          taxId: value,
          priceExVat,
          priceIncVat: formatVatPriceInput(priceExVatToIncVat(ex, newRate)),
        });
        return;
      }
    }
    if (priceIncVat !== '') {
      const inc = Number(priceIncVat);
      if (Number.isFinite(inc)) {
        emit({
          taxId: value,
          priceExVat: formatExVatInput(priceIncVatToExVat(inc, newRate)),
          priceIncVat,
        });
        return;
      }
    }
    emit({ taxId: value });
  }

  const labelSize = compact ? 'mb-1 block text-[10px] uppercase text-slate-400' : labelClassName;

  return (
    <>
      <div>
        <label className={labelSize}>
          Preço s/ IVA{required ? ' *' : ''}
        </label>
        <input
          className={inputClassName}
          type="number"
          min={0}
          step="0.0001"
          value={priceExVat}
          onChange={(e) => handleExChange(e.target.value)}
          required={required}
          disabled={disabled}
          readOnly={disabled}
        />
      </div>
      <div>
        <label className={labelSize}>
          Preço c/ IVA{required ? ' *' : ''}
        </label>
        <input
          className={inputClassName}
          type="number"
          min={0}
          step="0.01"
          value={priceIncVat}
          onChange={(e) => handleIncChange(e.target.value)}
          onBlur={handleIncBlur}
          disabled={disabled}
          readOnly={disabled}
        />
      </div>
      <div>
        <label className={labelSize}>
          IVA{required ? ' *' : ''}
        </label>
        <select
          className={inputClassName}
          value={taxIdStr}
          onChange={(e) => handleTaxChange(e.target.value)}
          required={required}
          disabled={disabled}
        >
          {taxes.map((t) => (
            <option key={t.tax_id} value={t.tax_id}>
              {t.name} ({t.value}%)
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

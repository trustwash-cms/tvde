export interface VatTaxRate {
  tax_id: number;
  name: string;
  value: number;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Precisão interna do preço s/ IVA — evita drift de 1 cêntimo no PVP. */
export const EX_VAT_DECIMALS = 4;

export function roundExVat(value: number): number {
  const factor = 10 ** EX_VAT_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function getTaxRateById(
  taxes: ReadonlyArray<Pick<VatTaxRate, 'tax_id' | 'value'>>,
  taxId: number,
  fallback = 23
): number {
  return taxes.find((t) => t.tax_id === taxId)?.value ?? fallback;
}

export function priceExVatToIncVat(exVat: number, ratePercent: number): number {
  return roundMoney(exVat * (1 + ratePercent / 100));
}

/**
 * Calcula o preço s/ IVA que, com IVA, arredonda exactamente ao PVP indicado.
 * Ex.: PVP 15,00 € a 23% → 12,1951 (não 12,20 que daria 15,01 €).
 */
export function exVatFromTargetIncVat(targetIncVat: number, ratePercent: number): number {
  const target = roundMoney(targetIncVat);
  if (ratePercent === 0) return roundExVat(target);

  const multiplier = 1 + ratePercent / 100;
  const start = roundExVat(target / multiplier);

  for (let offset = 0; offset <= 100; offset += 1) {
    for (const delta of offset === 0 ? [0] : [offset, -offset]) {
      const ex = roundExVat(start + delta * 0.0001);
      if (ex < 0) continue;
      if (roundMoney(ex * multiplier) === target) return ex;
    }
  }

  return start;
}

export function priceIncVatToExVat(incVat: number, ratePercent: number): number {
  return exVatFromTargetIncVat(incVat, ratePercent);
}

export function formatVatPriceInput(value: number): string {
  if (!Number.isFinite(value)) return '';
  return roundMoney(value).toFixed(2);
}

export function formatExVatInput(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = roundExVat(value);
  if (Math.abs(rounded - roundMoney(rounded)) < 1e-9) {
    return roundMoney(rounded).toFixed(2);
  }
  return rounded.toFixed(EX_VAT_DECIMALS);
}

export function formatIncVatDisplay(value: number): string {
  if (!Number.isFinite(value)) return '';
  return roundMoney(value).toFixed(2);
}

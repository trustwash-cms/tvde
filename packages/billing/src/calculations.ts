import type { InvoiceLineComputed, InvoiceLineInput, InvoiceTotals } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeLine(line: InvoiceLineInput): InvoiceLineComputed {
  const qty = Math.max(1, line.quantity);
  const vatRate = line.vatRate ?? 23;
  const lineSubtotal = round2(qty * line.unitPrice);
  const lineVat = round2(lineSubtotal * (vatRate / 100));
  const lineTotal = round2(lineSubtotal + lineVat);

  return {
    ...line,
    quantity: qty,
    vatRate,
    lineSubtotal,
    lineVat,
    lineTotal,
  };
}

export function computeInvoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  const computed = lines.map(computeLine);
  const subtotal = round2(computed.reduce((s, l) => s + l.lineSubtotal, 0));
  const vatAmount = round2(computed.reduce((s, l) => s + l.lineVat, 0));
  const total = round2(subtotal + vatAmount);
  return { subtotal, vatAmount, total };
}

import * as XLSX from 'xlsx';
import {
  formatAdminMgmtMoney,
  getAdminMgmtFaturaMetodoPagamentoLabel,
  getAdminMgmtFaturaPagamentoLabel,
  getAdminMgmtFaturaTipoLabel,
} from '@tvde/shared';

export interface FaturaExportSource {
  clienteNome: string;
  clienteNif: string | null;
  tipoDocumento: string;
  numero: string;
  dataEmissao: string;
  dataVencimento: string | null;
  descricaoResumo: string | null;
  valorTotal: string;
  estadoPagamento: string;
  dataPagamento: string | null;
  metodoPagamento: string | null;
  notificarCliente: boolean;
  anexoCount: number;
  notas: string | null;
}

function formatDatePt(value: string | null): string {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}

export function faturaMatchesSearch(row: FaturaExportSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    row.clienteNome,
    row.clienteNif,
    row.numero,
    row.descricaoResumo,
    row.notas,
    row.tipoDocumento,
    getAdminMgmtFaturaTipoLabel(row.tipoDocumento),
    row.estadoPagamento,
    getAdminMgmtFaturaPagamentoLabel(row.estadoPagamento),
    row.metodoPagamento,
    row.metodoPagamento ? getAdminMgmtFaturaMetodoPagamentoLabel(row.metodoPagamento) : '',
    row.dataEmissao,
    formatDatePt(row.dataEmissao),
    row.dataVencimento,
    formatDatePt(row.dataVencimento),
    row.dataPagamento,
    formatDatePt(row.dataPagamento),
    row.valorTotal,
    formatAdminMgmtMoney(row.valorTotal),
    String(row.anexoCount),
    row.notificarCliente ? 'sim alerta notificar' : 'não',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}

function toExportRows(rows: FaturaExportSource[]) {
  return rows.map((row) => ({
    Cliente: row.clienteNome,
    NIF: row.clienteNif ?? '',
    'N.º documento': row.numero,
    Tipo: getAdminMgmtFaturaTipoLabel(row.tipoDocumento),
    Emissão: formatDatePt(row.dataEmissao),
    Vencimento: formatDatePt(row.dataVencimento),
    Descrição: row.descricaoResumo ?? '',
    Total: formatAdminMgmtMoney(row.valorTotal),
    Estado: getAdminMgmtFaturaPagamentoLabel(row.estadoPagamento),
    'Data pagamento': formatDatePt(row.dataPagamento),
    'Método pagamento': row.metodoPagamento
      ? getAdminMgmtFaturaMetodoPagamentoLabel(row.metodoPagamento)
      : '',
    'Alerta cliente': row.notificarCliente ? 'Sim' : 'Não',
    PDFs: row.anexoCount,
    Notas: row.notas ?? '',
  }));
}

function exportFileName(ext: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `faturas-${stamp}.${ext}`;
}

export function exportFaturasToExcel(rows: FaturaExportSource[]) {
  if (rows.length === 0) return;
  const data = toExportRows(rows);
  const sheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Faturas');
  XLSX.writeFile(workbook, exportFileName('xlsx'));
}

export async function exportFaturasToPdf(rows: FaturaExportSource[]) {
  if (rows.length === 0) return;
  const [{ default: jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;
  const data = toExportRows(rows);
  const headers = Object.keys(data[0] ?? {});
  const body = data.map((row) => headers.map((h) => String(row[h as keyof typeof row] ?? '')));

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Listagem de faturas', 14, 14);
  doc.setFontSize(9);
  doc.text(`${rows.length} registo(s) · ${new Date().toLocaleString('pt-PT')}`, 14, 20);

  autoTable(doc, {
    head: [headers],
    body,
    startY: 24,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [71, 85, 105] },
    margin: { left: 10, right: 10 },
  });

  doc.save(exportFileName('pdf'));
}

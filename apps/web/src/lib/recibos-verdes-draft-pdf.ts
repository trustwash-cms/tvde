import {
  formatPtMoney,
  summarizeRecibosVerdesDraft,
  type RecibosVerdesDraft,
} from '@tvde/shared';

function formatDatePt(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}

function money(value: number): string {
  return `${formatPtMoney(value)} €`;
}

/**
 * PDF rascunho à semelhança da Fatura-Recibo AT (layout simplificado).
 * Não é documento fiscal — só para alinhar campos antes do Playwright na AT.
 */
export async function downloadRecibosVerdesDraftPdf(draft: RecibosVerdesDraft) {
  const { default: jsPDF } = await import('jspdf');
  const autoTableModule = await import('jspdf-autotable');
  const autoTable = autoTableModule.default;

  const totals = summarizeRecibosVerdesDraft(draft);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 12;

  const green: [number, number, number] = [34, 120, 80];
  const slate: [number, number, number] = [51, 65, 85];

  // Cabeçalho
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...slate);
  doc.text('AT autoridade tributária e aduaneira', margin, y);
  y += 8;

  doc.setFontSize(16);
  doc.text(`${draft.tipoDocumento}`, pageW / 2, y, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`<${draft.numeroDocumento}>`, pageW / 2, y + 6, { align: 'center' });
  doc.text(`emitida em ${formatDatePt(draft.dataEmissao)}`, pageW / 2, y + 11, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('RASCUNHO (não fiscal)', pageW / 2, y + 16, { align: 'center' });

  // ATCUD + QR placeholder
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`ATCUD: ${draft.atcud}`, pageW - margin, y, { align: 'right' });
  doc.setDrawColor(...slate);
  doc.rect(pageW - margin - 22, y + 3, 22, 22);
  doc.setFontSize(7);
  doc.text('QR', pageW - margin - 11, y + 15, { align: 'center' });
  y += 28;

  const section = (title: string) => {
    doc.setDrawColor(...green);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageW - margin, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...green);
    doc.text(title, margin, y);
    y += 5;
    doc.setTextColor(...slate);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
  };

  const kv = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(label, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(value || '—', pageW - margin * 2);
    doc.text(lines, margin, y + 4);
    y += 4 + lines.length * 4 + 2;
  };

  section('DADOS DO TRANSMITENTE');
  kv('NOME', draft.transmitenteNome);
  kv('DOMICÍLIO', draft.transmitenteMorada);
  kv('NÚMERO DE IDENTIFICAÇÃO FISCAL (NIF)', draft.transmitenteNif);

  section('DADOS DO ADQUIRENTE');
  kv('NOME', draft.adquirenteNome);
  kv('SEDE OU DOMICÍLIO', draft.adquirenteMorada);
  kv('NÚMERO DE IDENTIFICAÇÃO FISCAL', draft.adquirenteNif);

  section('DADOS DA TRANSMISSÃO DE BENS OU DA PRESTAÇÃO DE SERVIÇOS');
  doc.setFontSize(8);
  doc.text(
    `Documento emitido a título de: ${draft.motivoEmissao}`,
    margin,
    y
  );
  y += 4;
  doc.text(`Data de prestação: ${formatDatePt(draft.dataPrestacao)}`, margin, y);
  y += 6;

  const body = draft.linhas.map((linha) => {
    const q = Number(String(linha.quantidade).replace(',', '.')) || 1;
    const unit = Number(
      String(linha.precoUnitarioSemIva).replace(/\./g, '').replace(',', '.')
    ) || 0;
    const total = q * unit;
    return [
      linha.descricao,
      `${linha.quantidade} ${linha.unidade}`.trim(),
      money(unit),
      linha.desconto?.trim() ? linha.desconto : '-',
      `IVA ${linha.taxaIva} a)`,
      money(total),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['Descrição', 'Qtd', 'Valor unitário', 'Desconto', 'Taxa IVA', 'Total c/Imposto']],
    body,
    styles: { fontSize: 8, cellPadding: 1.5, textColor: slate },
    headStyles: { fillColor: green, textColor: 255, fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 22 },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 20, halign: 'center' },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;

  section('IVA');
  doc.setFontSize(8);
  const motivo =
    draft.linhas[0]?.motivoIsencao ||
    'IVA - Regime de isenção - Artigo 53.º n.º 1 do CIVA';
  doc.text(`0,00% - a) ${motivo}`, margin, y);
  y += 4;
  doc.text(`Valor tributável: ${money(totals.valorIliquido)}`, margin, y);
  y += 4;
  doc.text(`Valor IVA: ${money(totals.valorIva)}`, margin, y);
  y += 7;

  section('IRS');
  doc.text(`Base de incidência: ${draft.baseIncidenciaIrs}`, margin, y);
  y += 4;
  doc.text('Retenção na fonte IRS: ---', margin, y);
  y += 4;
  doc.text(`Rendimento: ${money(totals.valorIliquido)}`, margin, y);
  y += 4;
  doc.text('Valor IRS: 0,00 €', margin, y);
  y += 8;

  section('TOTAIS DO DOCUMENTO');
  const totalsBlock = [
    ['Valor ilíquido', money(totals.valorIliquido)],
    ['IVA', money(totals.valorIva)],
    ['Imposto do Selo', '0,00 €'],
    ['TOTAL DO DOCUMENTO', money(totals.totalDocumento)],
    ['Retenção na fonte IRS', '0,00 €'],
    ['TOTAL A PAGAR', money(totals.totalPagar)],
  ];
  for (const [label, value] of totalsBlock) {
    doc.setFont('helvetica', label.startsWith('TOTAL') ? 'bold' : 'normal');
    doc.text(label, pageW - margin - 70, y);
    doc.text(value, pageW - margin, y, { align: 'right' });
    y += 5;
  }

  y = Math.max(y + 10, 270);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100);
  doc.text(
    'RASCUNHO LOCAL TVDE — não substitui documento emitido no Portal das Finanças.',
    pageW / 2,
    y,
    { align: 'center' }
  );
  doc.text(`ATCUD: ${draft.atcud} · Página 1 de 1`, pageW / 2, y + 4, { align: 'center' });

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`rascunho-fatura-recibo-${stamp}.pdf`);
}

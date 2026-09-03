import {
  formatAdquirenteMoradaCompleta,
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
 * PDF rascunho à semelhança da Fatura-Recibo AT.
 * Sem nº de documento nem data de emissão (gerados só na AT).
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

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...slate);
  doc.text('AT autoridade tributária e aduaneira', margin, y);
  y += 8;

  doc.setFontSize(16);
  doc.text(`${draft.tipoDocumento}`, pageW / 2, y, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('RASCUNHO (não fiscal — nº e data de emissão na AT)', pageW / 2, y + 7, {
    align: 'center',
  });
  if (draft.dataPrestacao) {
    doc.text(`Data de prestação: ${formatDatePt(draft.dataPrestacao)}`, pageW / 2, y + 13, {
      align: 'center',
    });
  }
  y += 22;

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
  kv('SEDE OU DOMICÍLIO', formatAdquirenteMoradaCompleta(draft));
  kv('NÚMERO DE IDENTIFICAÇÃO FISCAL', draft.adquirenteNif);

  section('DADOS DA TRANSMISSÃO DE BENS OU DA PRESTAÇÃO DE SERVIÇOS');
  doc.setFontSize(8);
  doc.text(`Documento emitido a título de: ${draft.motivoEmissao}`, margin, y);
  y += 4;
  doc.text(`Data de prestação: ${formatDatePt(draft.dataPrestacao)}`, margin, y);
  y += 6;

  const body = draft.linhas.map((linha) => {
    const q = Number(String(linha.quantidade).replace(',', '.')) || 1;
    const unit =
      Number(String(linha.precoUnitarioSemIva).replace(/\./g, '').replace(',', '.')) || 0;
    const total = q * unit;
    return [
      [linha.referencia, linha.descricao].filter(Boolean).join(' - ') || linha.descricao,
      `${linha.quantidade} ${linha.unidade}`.trim(),
      money(unit),
      linha.desconto?.trim() ? linha.desconto : '-',
      `IVA ${linha.taxaIva.startsWith('0') ? '0%' : linha.taxaIva.split(' ')[0]} a)`,
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
  for (const row of totals.porTaxa) {
    const motivo = row.motivo ? ` - a) ${row.motivo}` : '';
    doc.setFontSize(8);
    doc.text(`${row.taxa}${motivo}`, margin, y);
    y += 4;
    doc.text(`Valor tributável: ${money(row.valorTributavel)}`, margin, y);
    y += 4;
    doc.text(`Valor IVA: ${money(row.valorIva)}`, margin, y);
    y += 6;
  }

  if (draft.baseIncidenciaIrs) {
    section('IRS');
    doc.text(`Base de incidência: ${draft.baseIncidenciaIrs}`, margin, y);
    y += 4;
    doc.text(
      `Retenção na fonte IRS: ${draft.retencaoFonteIrs || '---'}`,
      margin,
      y
    );
    y += 4;
    doc.text(`Rendimento: ${money(totals.valorIliquido)}`, margin, y);
    y += 8;
  }

  if (draft.observacoes?.trim()) {
    section('OBSERVAÇÕES');
    const obs = doc.splitTextToSize(draft.observacoes, pageW - margin * 2);
    doc.text(obs, margin, y);
    y += obs.length * 4 + 4;
  }

  section('TOTAIS DO DOCUMENTO');
  const totalsBlock = [
    ['Valor ilíquido', money(totals.valorIliquido)],
    ['IVA', money(totals.valorIva)],
    ['Imposto do Selo', '0,00 €'],
    ['TOTAL DO DOCUMENTO', money(totals.totalDocumento)],
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

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`rascunho-fatura-recibo-${stamp}.pdf`);
}

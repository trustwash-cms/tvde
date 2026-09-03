import {
  formatLinhaReferenciaDescricaoAt,
  formatPtMoney,
  parseIvaPercent,
  summarizeRecibosVerdesDraft,
  type RecibosVerdesDraft,
} from '@tvde/shared';

function money(value: number): string {
  return `${formatPtMoney(value)} €`;
}

/**
 * PDF rascunho alinhado ao resultado da emissão AT (Fatura-Recibo).
 * Nº documento, data emissão e ATCUD só existem na AT — aqui ficam como placeholders.
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

  const blue: [number, number, number] = [0, 115, 187];
  const slate: [number, number, number] = [51, 51, 51];

  const ensureSpace = (need: number) => {
    if (y + need > 285) {
      doc.addPage();
      y = 14;
    }
  };

  const section = (title: string) => {
    ensureSpace(14);
    doc.setFillColor(...blue);
    doc.rect(margin, y, pageW - margin * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(title, margin + 2, y + 4.8);
    y += 10;
    doc.setTextColor(...slate);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
  };

  const kv = (label: string, value: string) => {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(80);
    doc.text(label, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...slate);
    const lines = doc.splitTextToSize(value || '—', pageW - margin * 2);
    doc.text(lines, margin, y + 4);
    y += 4 + lines.length * 4 + 2;
  };

  // Cabeçalho resultado
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...blue);
  doc.text('RASCUNHO · (n.º e ATCUD na emissão AT)', margin, y);
  y += 6;
  doc.setFontSize(14);
  doc.setTextColor(...slate);
  doc.text(draft.tipoDocumento, margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Emitida a — (gerada na AT)`, margin, y);
  y += 4;
  doc.text('ATCUD: — (gerado na AT)', margin, y);
  y += 4;
  doc.text('Via de Emissão: Portal (rascunho local TVDE)', margin, y);
  y += 4;
  doc.text('Sem Documentos associados.', margin, y);
  y += 8;

  section('Transmitente');
  kv('NIF', draft.transmitenteNif);
  kv('Nome', draft.transmitenteNome);
  kv('Domicílio fiscal / Estabelecimento estável', draft.transmitenteMorada);
  kv('Atividade exercida', draft.transmitenteAtividade || '—');

  section('Adquirente');
  kv('País', draft.adquirentePais.toUpperCase());
  kv('NIF', draft.adquirenteNif);
  kv('Nome', draft.adquirenteNome);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Morada de Cliente', margin, y);
  y += 5;
  kv('Morada', draft.adquirenteMorada);
  kv('Código Postal', draft.adquirenteCodigoPostal);
  kv('Localidade', draft.adquirenteLocalidade);
  kv('País', draft.adquirentePais.toUpperCase());

  section('Motivo de Emissão');
  kv('Documento emitido a título de', draft.motivoEmissao);

  section('Produtos, Serviços ou Outros');
  const body = draft.linhas.map((linha) => {
    const fmt = formatLinhaReferenciaDescricaoAt(linha);
    const ivaPct = parseIvaPercent(linha.taxaIva);
    const ivaLabel = `${formatPtMoney(ivaPct)}%${ivaPct === 0 ? ' a)' : ''}`;
    return [
      `${fmt.linha1}\n${fmt.linha2}\n${fmt.linha3}`,
      ivaLabel,
      money(lineTotalFromLinha(linha)),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['Referência / Descrição', 'Taxa IVA', 'Total c/Imposto']],
    body: body.length
      ? body
      : [['Sem linhas', '—', '—']],
    styles: { fontSize: 8, cellPadding: 2, textColor: slate, valign: 'top' },
    headStyles: { fillColor: blue, textColor: 255, fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 110 },
      1: { cellWidth: 28 },
      2: { cellWidth: 32, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;

  section('Taxas de IVA');
  autoTable(doc, {
    startY: y,
    head: [
      [
        'Taxa | Motivo de isenção/não sujeição/não tributação',
        'Valor Tributável',
        'Valor do IVA',
      ],
    ],
    body:
      totals.porTaxa.length > 0
        ? totals.porTaxa.map((row) => [
            `${row.taxa}${row.motivo ? ` - a) ${row.motivo}` : ''}`,
            money(row.valorTributavel),
            money(row.valorIva),
          ])
        : [['—', '—', '—']],
    styles: { fontSize: 8, cellPadding: 1.8, textColor: slate },
    headStyles: { fillColor: [240, 240, 240], textColor: slate, fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 110 },
      1: { cellWidth: 30, halign: 'right' },
      2: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;

  if (draft.baseIncidenciaIrs || totals.valorIliquido > 0) {
    section('IRS');
    kv('Base de incidência em IRS', draft.baseIncidenciaIrs || '—');
    kv('Retenção na fonte IRS', draft.retencaoFonteIrs || '- - -');
    kv('Rendimento Tributável', money(totals.rendimentoTributavel));
    kv('Valor de IRS', money(totals.valorIrs));
  }

  if (draft.observacoes?.trim()) {
    section('Observações');
    const obs = doc.splitTextToSize(draft.observacoes, pageW - margin * 2);
    doc.text(obs, margin, y);
    y += obs.length * 4 + 4;
  }

  section(`Totais da ${draft.tipoDocumento}`);
  kv('Data da transação', draft.dataPrestacao || '—');
  const totalsBlock: Array<[string, string]> = [
    ['Valor ilíquido', money(totals.valorIliquido)],
    ['IVA', money(totals.valorIva)],
    ['Imposto do Selo', money(totals.impostoSelo)],
    ['TOTAL DO DOCUMENTO', money(totals.totalDocumento)],
    ['Retenção na fonte IRS', money(totals.retencaoIrs)],
    ['TOTAL A PAGAR', money(totals.totalPagar)],
  ];
  for (const [label, value] of totalsBlock) {
    ensureSpace(6);
    doc.setFont('helvetica', label.startsWith('TOTAL') ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.text(label, margin, y);
    doc.text(value, pageW - margin, y, { align: 'right' });
    y += 5;
  }

  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    'RASCUNHO LOCAL TVDE — não substitui documento emitido no Portal das Finanças.',
    pageW / 2,
    Math.min(y, 290),
    { align: 'center' }
  );

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`rascunho-fatura-recibo-${stamp}.pdf`);
}

function lineTotalFromLinha(linha: RecibosVerdesDraft['linhas'][number]): number {
  const q = Number(String(linha.quantidade).replace(',', '.')) || 1;
  const unit =
    Number(String(linha.precoUnitarioSemIva).replace(/\./g, '').replace(',', '.')) || 0;
  const disc = Number(String(linha.desconto || '0').replace(/\./g, '').replace(',', '.')) || 0;
  const base = Math.max(0, q * unit - disc);
  const ivaPct = parseIvaPercent(linha.taxaIva);
  return base + (base * ivaPct) / 100;
}

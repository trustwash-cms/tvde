export const RECIBOS_VERDES_CSV_MAX_ROWS = 2000;

export const RECIBOS_VERDES_CSV_COLUMNS = {
  referencia: 'Referência',
  tipoDocumento: 'Tipo Documento',
  atcud: 'ATCUD',
  situacao: 'Situação',
  dataTransacao: 'Data da Transação',
  motivoEmissao: 'Motivo Emissão',
  dataEmissao: 'Data de Emissão',
  paisAdquirente: 'País do Adquirente',
  nifAdquirente: 'NIF Adquirente',
  nomeAdquirente: 'Nome do Adquirente',
  valorTributavel: 'Valor Tributável (em euros)',
  valorIva: 'Valor do IVA (em euros)',
  totalDocumento: 'Total do Documento (em euros)',
} as const;

export interface RecibosVerdesCsvRowError {
  line: number;
  referencia?: string;
  message: string;
}

export interface RecibosVerdesCsvParsedRow {
  line: number;
  referencia: string;
  tipoDocumento: string;
  tipoDocumentoCms: string;
  atcud: string | null;
  situacao: string;
  dataEmissao: string;
  nifAdquirente: string | null;
  nomeAdquirente: string;
  motivoEmissao: string | null;
  valorLiquido: string;
  valorIva: string;
  valorTotal: string;
  estadoPagamento: 'pago' | 'pendente';
  origemExternaId: string;
}

export interface RecibosVerdesCsvParseResult {
  rows: RecibosVerdesCsvParsedRow[];
  errors: RecibosVerdesCsvRowError[];
}

export interface RecibosVerdesImportPreviewRow extends RecibosVerdesCsvParsedRow {
  status: 'novo' | 'duplicado' | 'erro';
  clienteExistente: boolean;
  message?: string;
}

export interface RecibosVerdesImportResult {
  clientesCriados: number;
  clientesActualizados: number;
  faturasCriadas: number;
  faturasIgnoradas: number;
  erros: RecibosVerdesCsvRowError[];
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

export function parseEuropeanDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function formatDecimalMoney(value: number): string {
  return value.toFixed(2);
}

export function normalizeNifImport(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.replace(/\s/g, '').toUpperCase();
}

export function mapSireTipoDocumento(raw: string): string {
  const n = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (n.includes('fatura') && n.includes('recibo')) return 'fatura_recibo';
  if (n.includes('recibo')) return 'recibo_verde';
  if (n.includes('nota') && n.includes('credito')) return 'nota_credito';
  if (n.includes('fatura')) return 'fatura';
  return 'outro';
}

export function inferEstadoPagamentoFromSire(tipoDocumentoCms: string, situacao: string): 'pago' | 'pendente' {
  const sit = situacao.trim().toLowerCase();
  if (sit === 'emitido' && (tipoDocumentoCms === 'fatura_recibo' || tipoDocumentoCms === 'recibo_verde')) {
    return 'pago';
  }
  if (sit === 'pago' || sit === 'liquidado') return 'pago';
  return 'pendente';
}

function parseCsvLine(line: string, separator: string): string[] {
  return line.split(separator).map((cell) => cell.trim());
}

export function parseRecibosVerdesCsv(csvText: string): RecibosVerdesCsvParseResult {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const errors: RecibosVerdesCsvRowError[] = [];
  const rows: RecibosVerdesCsvParsedRow[] = [];

  if (lines.length < 2) {
    return { rows, errors: [{ line: 1, message: 'Ficheiro vazio ou sem dados' }] };
  }

  const separator = lines[0].includes(';') ? ';' : ',';
  const headers = parseCsvLine(lines[0], separator).map(normalizeHeader);

  function col(name: string): number {
    return headers.findIndex((h) => h === name);
  }

  const idx = {
    referencia: col(RECIBOS_VERDES_CSV_COLUMNS.referencia),
    tipoDocumento: col(RECIBOS_VERDES_CSV_COLUMNS.tipoDocumento),
    atcud: col(RECIBOS_VERDES_CSV_COLUMNS.atcud),
    situacao: col(RECIBOS_VERDES_CSV_COLUMNS.situacao),
    dataEmissao: col(RECIBOS_VERDES_CSV_COLUMNS.dataEmissao),
    motivoEmissao: col(RECIBOS_VERDES_CSV_COLUMNS.motivoEmissao),
    nifAdquirente: col(RECIBOS_VERDES_CSV_COLUMNS.nifAdquirente),
    nomeAdquirente: col(RECIBOS_VERDES_CSV_COLUMNS.nomeAdquirente),
    valorTributavel: col(RECIBOS_VERDES_CSV_COLUMNS.valorTributavel),
    valorIva: col(RECIBOS_VERDES_CSV_COLUMNS.valorIva),
    totalDocumento: col(RECIBOS_VERDES_CSV_COLUMNS.totalDocumento),
  };

  if (idx.referencia < 0 || idx.dataEmissao < 0 || idx.totalDocumento < 0) {
    return {
      rows,
      errors: [
        {
          line: 1,
          message:
            'Cabeçalho inválido — exporte a tabela em Consultar → Exportar tabela (formato SIRE)',
        },
      ],
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > RECIBOS_VERDES_CSV_MAX_ROWS) {
    return {
      rows,
      errors: [
        {
          line: 1,
          message: `Máximo ${RECIBOS_VERDES_CSV_MAX_ROWS} linhas por importação`,
        },
      ],
    };
  }

  for (let i = 0; i < dataLines.length; i++) {
    const lineNo = i + 2;
    const cells = parseCsvLine(dataLines[i], separator);
    const get = (index: number) => (index >= 0 && index < cells.length ? cells[index].trim() : '');

    const referencia = get(idx.referencia);
    if (!referencia) {
      errors.push({ line: lineNo, message: 'Referência em falta' });
      continue;
    }

    const dataEmissao = get(idx.dataEmissao);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao)) {
      errors.push({ line: lineNo, referencia, message: `Data de emissão inválida: ${dataEmissao || '—'}` });
      continue;
    }

    const total = parseEuropeanDecimal(get(idx.totalDocumento));
    if (total == null) {
      errors.push({ line: lineNo, referencia, message: 'Total do documento inválido' });
      continue;
    }

    const liquido = parseEuropeanDecimal(get(idx.valorTributavel)) ?? total;
    const iva = parseEuropeanDecimal(get(idx.valorIva)) ?? 0;
    const tipoRaw = get(idx.tipoDocumento) || 'Fatura-Recibo';
    const tipoDocumentoCms = mapSireTipoDocumento(tipoRaw);
    const situacao = get(idx.situacao) || 'Emitido';
    const nif = normalizeNifImport(get(idx.nifAdquirente));
    const nomeRaw = get(idx.nomeAdquirente).trim();
    const nomeAdquirente = nomeRaw || (nif ? `Cliente ${nif}` : 'Consumidor final');
    const atcud = get(idx.atcud) || null;

    rows.push({
      line: lineNo,
      referencia,
      tipoDocumento: tipoRaw,
      tipoDocumentoCms,
      atcud,
      situacao,
      dataEmissao,
      nifAdquirente: nif,
      nomeAdquirente,
      motivoEmissao: get(idx.motivoEmissao) || null,
      valorLiquido: formatDecimalMoney(liquido),
      valorIva: formatDecimalMoney(iva),
      valorTotal: formatDecimalMoney(total),
      estadoPagamento: inferEstadoPagamentoFromSire(tipoDocumentoCms, situacao),
      origemExternaId: atcud || referencia,
    });
  }

  return { rows, errors };
}

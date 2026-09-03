/**
 * Rascunho local de Fatura-Recibo (AT) — alinhar campos sem emitir no Portal das Finanças.
 * Valores de exemplo baseados na fatura real «fatura 24 TVDE».
 */

export const RECIBOS_VERDES_MOTIVO_EMISSAO =
  'Pagamento dos bens ou dos serviços' as const;

export const RECIBOS_VERDES_MOTIVO_ISENCAO_IVA =
  'IVA - Regime de isenção - Artigo 53.º n.º 1 do CIVA' as const;

export const RECIBOS_VERDES_BASE_IRS =
  'Sem retenção - Art. 101.º, n.º 1 do CIRS' as const;

export const RECIBOS_VERDES_DOCUMENTO_TIPOS = ['Fatura', 'Fatura-Recibo'] as const;
export type RecibosVerdesDocumentoTipo = (typeof RECIBOS_VERDES_DOCUMENTO_TIPOS)[number];

export const RECIBOS_VERDES_LINHA_TIPOS = ['Produto', 'Serviço', 'Outros'] as const;
export type RecibosVerdesLinhaTipo = (typeof RECIBOS_VERDES_LINHA_TIPOS)[number];

export const RECIBOS_VERDES_TIPO_REF = ['Outro', 'EAN'] as const;
export type RecibosVerdesTipoRef = (typeof RECIBOS_VERDES_TIPO_REF)[number];

/** Opções comuns do select Taxa IVA no Portal das Finanças. */
export const RECIBOS_VERDES_TAXAS_IVA = [
  '0%',
  '6% - Taxa Reduzida - Continente',
  '13% - Taxa Intermédia - Continente',
  '23% - Taxa Normal - Continente',
  '4% - Taxa Reduzida - RA Madeira',
  '12% - Taxa Intermédia - RA Madeira',
  '22% - Taxa Normal - RA Madeira',
  '4% - Taxa Reduzida - RA Açores',
  '9% - Taxa Intermédia - RA Açores',
  '16% - Taxa Normal - RA Açores',
] as const;

export const RECIBOS_VERDES_MOTIVOS_ISENCAO = [
  'IVA - Regime de isenção - Artigo 53.º n.º 1 do CIVA',
  'Isento Artigo 9.º do CIVA',
  'Isento Artigo 13.º do CIVA',
  'Isento Artigo 14.º do CIVA',
  'Isento Artigo 15.º do CIVA',
  'Não sujeito ou não tributado',
  'Outras isenções',
] as const;

export interface RecibosVerdesDraftLinha {
  tipo: RecibosVerdesLinhaTipo;
  tipoRef: RecibosVerdesTipoRef;
  referencia: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  precoUnitarioSemIva: string;
  /** Taxa de desconto comercial (%) */
  taxaDesconto: string;
  /** Valor a descontar (€) */
  desconto: string;
  taxaIva: string;
  motivoIsencao: string;
}

export interface RecibosVerdesDraft {
  /** Ex.: FR ATSIRE01FR/24 — no rascunho é só visual */
  numeroDocumento: string;
  tipoDocumento: RecibosVerdesDocumentoTipo;
  dataEmissao: string;
  /** Data da transação / prestação no formulário AT */
  dataPrestacao: string;
  atcud: string;
  motivoEmissao: string;
  transmitenteNome: string;
  transmitenteNif: string;
  transmitenteMorada: string;
  transmitenteAtividade: string;
  adquirentePais: string;
  adquirenteNome: string;
  adquirenteNif: string;
  adquirenteMorada: string;
  observacoes: string;
  linhas: RecibosVerdesDraftLinha[];
  baseIncidenciaIrs: string;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Defaults alinhados à fatura real 24 TVDE (para comparar o PDF rascunho). */
export function createRecibosVerdesDraftExample(): RecibosVerdesDraft {
  return {
    numeroDocumento: 'FR ATSIRE01FR/RASCUNHO',
    tipoDocumento: 'Fatura-Recibo',
    dataEmissao: todayIso(),
    dataPrestacao: '2026-06-21',
    atcud: 'RASCUNHO-LOCAL',
    motivoEmissao: RECIBOS_VERDES_MOTIVO_EMISSAO,
    transmitenteNome: 'FERNANDO CARLOS RODRIGUES PEREIRA',
    transmitenteNif: '266187420',
    transmitenteMorada: 'R DO MIRAMAR LOTE 3 2655-309 ERICEIRA',
    transmitenteAtividade: '',
    adquirentePais: 'Portugal',
    adquirenteNome: 'CAMINHOS TOLERANTES UNIPESSOAL LDA',
    adquirenteNif: '515198609',
    adquirenteMorada: 'RUA LUIS PACHECO LOTE 30 6 A, 1950-244 LISBOA, PORTUGAL',
    observacoes: '',
    linhas: [
      {
        tipo: 'Serviço',
        tipoRef: 'Outro',
        referencia: '',
        descricao: 'OUT - TVDE 2026 Serviço SEMANA DO 08/06 AO 14/06',
        quantidade: '1',
        unidade: 'Unidade',
        precoUnitarioSemIva: '390,64',
        taxaDesconto: '',
        desconto: '',
        taxaIva: '0%',
        motivoIsencao: RECIBOS_VERDES_MOTIVO_ISENCAO_IVA,
      },
    ],
    baseIncidenciaIrs: RECIBOS_VERDES_BASE_IRS,
  };
}

export function parsePtMoney(value: string): number {
  const cleaned = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatPtMoney(value: number): string {
  return value.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function summarizeRecibosVerdesDraft(draft: RecibosVerdesDraft): {
  valorIliquido: number;
  valorIva: number;
  totalDocumento: number;
  totalPagar: number;
} {
  let valorIliquido = 0;
  let valorIva = 0;
  for (const linha of draft.linhas) {
    const q = parsePtMoney(linha.quantidade) || 1;
    const unit = parsePtMoney(linha.precoUnitarioSemIva);
    const disc = parsePtMoney(linha.desconto);
    const base = Math.max(0, q * unit - disc);
    const ivaPct = parsePtMoney(linha.taxaIva.replace('%', ''));
    valorIliquido += base;
    valorIva += (base * ivaPct) / 100;
  }
  const totalDocumento = valorIliquido + valorIva;
  return {
    valorIliquido,
    valorIva,
    totalDocumento,
    totalPagar: totalDocumento,
  };
}

/**
 * Rascunho local de Fatura-Recibo (AT) — alinhar campos sem emitir no Portal das Finanças.
 */

export const RECIBOS_VERDES_MOTIVO_EMISSAO =
  'Pagamento dos bens ou dos serviços' as const;

export const RECIBOS_VERDES_MOTIVO_ISENCAO_IVA =
  'IVA - Regime de isenção - Artigo 53.º n.º 1 do CIVA' as const;

export const RECIBOS_VERDES_BASE_IRS =
  'Sem retenção - Art.101.º, n.º1 do CIRS' as const;

export const RECIBOS_VERDES_DOCUMENTO_TIPOS = ['Fatura', 'Fatura-Recibo'] as const;
export type RecibosVerdesDocumentoTipo = (typeof RECIBOS_VERDES_DOCUMENTO_TIPOS)[number];

export const RECIBOS_VERDES_LINHA_TIPOS = ['Produto', 'Serviço', 'Outros'] as const;
export type RecibosVerdesLinhaTipo = (typeof RECIBOS_VERDES_LINHA_TIPOS)[number];

export const RECIBOS_VERDES_TIPO_REF = ['Outro', 'EAN'] as const;
export type RecibosVerdesTipoRef = (typeof RECIBOS_VERDES_TIPO_REF)[number];

export const RECIBOS_VERDES_TAXAS_IVA = [
  '23% - Taxa Normal - Continente',
  '13% - Taxa Intermédia - Continente',
  '6% - Taxa Reduzida - Continente',
  '16% - Taxa Normal - RA Açores',
  '9% - Taxa Intermédia - RA Açores',
  '4% - Taxa Reduzida - RA Açores',
  '22% - Taxa Normal - RA Madeira',
  '12% - Taxa Intermédia - RA Madeira',
  '4% - Taxa Reduzida - RA Madeira',
  '0%',
] as const;

export const RECIBOS_VERDES_MOTIVOS_ISENCAO = [
  'Artigo 16.º n.º 6 do CIVA',
  'Artigo 6.º do Decreto-Lei n.º 198/90, de 19 de Junho',
  'Exigibilidade de caixa',
  'Isento Artigo 13.º do CIVA',
  'Isento Artigo 14.º do CIVA',
  'Isento Artigo 15.º do CIVA',
  'Isento Artigo 9.º do CIVA',
  'IVA - não confere direito a dedução - Artigo 62.º',
  'IVA - Regime de isenção - Artigo 53.º n.º 1 do CIVA',
  'Regime particular do tabaco',
  'Regime da margem de lucro-Agências de viagens',
  'Regime da margem de lucro-Bens em segunda mão',
  'Regime da margem de lucro-Objetos de arte',
  'Regime da margem de lucro-Objetos de coleção e antiguidades',
  'Isento Artigo 14.º do RITI',
  'Outras isenções',
  'IVA - Regime forfetário',
  'IVA - não confere direito à dedução (ou similar) - Artigo 72.º',
  'Mercadorias à consignação',
  'Isenção de IVA com direito à dedução no cabaz alimentar',
  'IVA - autoliquidação - Artigo 2.º n.º 1 alínea i) do CIVA',
  'IVA - autoliquidação - Artigo 2.º n.º 1 alínea l) do CIVA',
  'IVA - autoliquidação - Artigo 2.º n.º 1 alínea m) do CIVA',
  'IVA - autoliquidação - Artigo 2.º n.º 1 alínea n) do CIVA',
  'IVA - autoliquidação - Artigo 8.º n.º 3 do RITI',
  'IVA - autoliquidação - Decreto-Lei n.º 21/2007, de 29 de janeiro',
  'IVA - autoliquidação - Decreto-Lei n.º 362/99, de 16 de setembro',
  'IVA - Regras específicas - artigo 6.º - Artigo 6.º do CIVA - Regras específicas',
  'IVA - regime transfronteiriço de isenção - Artigo 58.º-A do CIVA',
  'Não sujeito ou não tributado',
] as const;

export const RECIBOS_VERDES_IMPOSTO_SELO = [
  '',
  '10.1 - Garantias de prazo inferior a um ano - por cada mês ou fracção',
  '10.2 - Garantias de prazo igual ou superior a um ano',
  '10.3 - Garantias sem prazo ou de prazo igual ou superior a cinco anos',
  '11.1.1 - Apostas mútuas',
  '11.1.2 - Outras apostas',
  '11.2.1 - Do bingo',
  '11.2.2 - Dos restantes',
  '11.3 - Jogos sociais do Estado: incluídos no preço de venda da aposta',
  '17.1.1 - Crédito de prazo inferior a um ano - por cada mês ou fracção',
  '17.1.2 - Crédito de prazo igual ou superior a um ano',
  '17.1.3 - Crédito de prazo igual ou superior a cinco anos',
  '17.1.4 - Crédito utilizado sob a forma de conta corrente, descoberto bancário ou qualquer outra forma em que o prazo de utilização não seja determinado ou...',
  '17.2.1 - Crédito de prazo inferior a um ano - por cada mês ou fracção',
  '17.2.2 - Crédito de prazo igual ou superior a um ano (Redação da Lei n.º 2/2020, de 31 de março)',
  '17.2.3 - Crédito de prazo igual ou superior a cinco anos (Redação da Lei n.º 2/2020, de 31 de março)',
  '23.1 - Letras - sobre o respectivo valor, com o mínimo de (euro) 1',
  '23.2 - Livranças - sobre o respectivo valor, com o mínimo de (euro) 1',
  '23.3 - Ordens e escritos de qualquer natureza, com exclusão dos cheques, nos quais se determine pagamento ou entrega de dinheiro com cláusula à ordem ou à...',
  '23.4 - Extractos de facturas e facturas conferidas - sobre o respectivo valor, com o mínimo de € 0,5 Red.Lei n.º 55-B/2004, de 30/12-Até 31 de Dezembro de ...',
  '27.1 - Trespasses de estabelecimento comercial, industrial ou agrícola - sobre o seu valor',
  '27.2 - Subconcessões e trespasses de concessões feitos pelo Estado, pelas Regiões Autónomas ou pelas autarquias locais, para exploração de empresas ou de ...',
  '2 - Arrendamento e subarrendamento, incluindo as alterações que envolvam aumento de renda operado pela revisão de cláusulas contratuais e a promessa quando seguida da disponibiliz...',
  '4 - Cheques de qualquer natureza, passados no território nacional - por cada um',
  '18 - Precatórios ou mandados para levantamento e entrega de dinheiro ou valores existente - sobre a importância a levantar ou a entregar',
  '22.2 - Comissões cobradas pela actividade de mediação - sobre o respectivo valor líquido de imposto do selo',
  '30 - Criptoativos - Comissões e contraprestações cobradas por ou com intermediação de prestadores de serviços de criptoativos',
] as const;

export const RECIBOS_VERDES_BASES_IRS = [
  'Dispensa de retenção - art. 101.º-B, n.º1, al. a) e b), do CIRS',
  'Dispensa de retenção - art. 101.º-B, n.º1, al. c), do CIRS',
  'Dispensa de retenção - art. 101.º-B, n.º1, al. d), do CIRS',
  'Sem retenção - Art.101.º, n.º1 do CIRS',
  'Sem retenção - Não residente sem estabelecimento',
  'Sobre 100% - art. 101.º, n.ºs 1 e 9, do CIRS',
  'Sobre 25% - art. 101.º-D, n.º 3, do CIRS',
  'Sobre 50% - art. 101.º-D, n.º 1, do CIRS',
  'Sobre 50% - art. 12.º-A do CIRS',
] as const;

/** Bases IRS que exigem select «Retenção na fonte IRS». */
export const RECIBOS_VERDES_BASES_IRS_COM_RETENCAO = [
  'Sobre 100% - art. 101.º, n.ºs 1 e 9, do CIRS',
  'Sobre 25% - art. 101.º-D, n.º 3, do CIRS',
  'Sobre 50% - art. 101.º-D, n.º 1, do CIRS',
  'Sobre 50% - art. 12.º-A do CIRS',
] as const;

export const RECIBOS_VERDES_TAXAS_RETENCAO_IRS = [
  'A taxa de 11.5%- art.º 101.º, n.º1, do CIRS',
  'A taxa de 16.5%- art.º 101.º, n.º1, do CIRS',
  'À taxa de 11.6% - Açores DLR n.º 15-A/2021/A, 31/05',
  'À taxa de 14% - Açores DLR n.º 15-A/2021/A, 31/05',
  'À taxa de 16,1% - Madeira DLR n.º 2/2025/M, 02/07 - RAM2025',
  'À taxa de 16.1% - Açores DLR n.º 15-A/2021/A, 31/05 - OE2025',
  'À taxa de 17.5% - Açores DLR n.º 15-A/2021/A, 31/05',
  'À taxa de 20% - art. 101.º, n.º1, do CIRS',
  'À taxa de 23% - art. 101.º, n.º1, do CIRS - OE2025',
  'À taxa de 25% - art. 101.º, n.º1, do CIRS',
  'À taxa de 8.10% - Açores DLR n.º 15-A/2021/A, 31/05',
] as const;

export function recibosVerdesNeedsRetencaoIrs(base: string): boolean {
  return (RECIBOS_VERDES_BASES_IRS_COM_RETENCAO as readonly string[]).includes(base);
}

export interface RecibosVerdesDraftLinha {
  id: string;
  tipo: RecibosVerdesLinhaTipo;
  tipoRef: RecibosVerdesTipoRef;
  referencia: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  precoUnitarioSemIva: string;
  taxaDesconto: string;
  desconto: string;
  taxaIva: string;
  motivoIsencao: string;
  verbaImpostoSelo: string;
}

/** Referência local guardada (catálogo de produtos/serviços). */
export interface RecibosVerdesCatalogItem {
  id: string;
  tipo: RecibosVerdesLinhaTipo;
  tipoRef: RecibosVerdesTipoRef;
  referencia: string;
  descricao: string;
  unidade: string;
  precoUnitarioSemIva: string;
  taxaIva: string;
  motivoIsencao: string;
  updatedAt: string;
}

export interface RecibosVerdesDraft {
  tipoDocumento: RecibosVerdesDocumentoTipo;
  /** Data da transação / prestação */
  dataPrestacao: string;
  motivoEmissao: string;
  transmitenteNome: string;
  transmitenteNif: string;
  transmitenteMorada: string;
  transmitenteAtividade: string;
  adquirentePais: string;
  adquirenteNome: string;
  adquirenteNif: string;
  adquirenteMorada: string;
  adquirenteCodigoPostal: string;
  adquirenteLocalidade: string;
  observacoes: string;
  linhas: RecibosVerdesDraftLinha[];
  baseIncidenciaIrs: string;
  retencaoFonteIrs: string;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function createRecibosVerdesLinhaId(): string {
  return `ln_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyRecibosVerdesLinha(): RecibosVerdesDraftLinha {
  return {
    id: createRecibosVerdesLinhaId(),
    tipo: 'Serviço',
    tipoRef: 'Outro',
    referencia: '',
    descricao: '',
    quantidade: '1',
    unidade: 'Unidade',
    precoUnitarioSemIva: '',
    taxaDesconto: '',
    desconto: '',
    taxaIva: '0%',
    motivoIsencao: RECIBOS_VERDES_MOTIVO_ISENCAO_IVA,
    verbaImpostoSelo: '',
  };
}

/** Defaults alinhados à fatura real 24 TVDE. */
export function createRecibosVerdesDraftExample(): RecibosVerdesDraft {
  return {
    tipoDocumento: 'Fatura-Recibo',
    dataPrestacao: '2026-06-21',
    motivoEmissao: RECIBOS_VERDES_MOTIVO_EMISSAO,
    transmitenteNome: 'FERNANDO CARLOS RODRIGUES PEREIRA',
    transmitenteNif: '266187420',
    transmitenteMorada: 'R DO MIRAMAR LOTE 3 2655-309 ERICEIRA',
    transmitenteAtividade: '',
    adquirentePais: 'Portugal',
    adquirenteNome: 'CAMINHOS TOLERANTES UNIPESSOAL LDA',
    adquirenteNif: '515198609',
    adquirenteMorada: 'RUA LUIS PACHECO LOTE 30 6 A',
    adquirenteCodigoPostal: '1950-244',
    adquirenteLocalidade: 'LISBOA',
    observacoes: '',
    linhas: [
      {
        ...createEmptyRecibosVerdesLinha(),
        referencia: 'OUT',
        descricao: 'TVDE 2026 Serviço SEMANA DO 08/06 AO 14/06',
        precoUnitarioSemIva: '390,64',
        taxaIva: '0%',
        motivoIsencao: RECIBOS_VERDES_MOTIVO_ISENCAO_IVA,
      },
    ],
    baseIncidenciaIrs: RECIBOS_VERDES_BASE_IRS,
    retencaoFonteIrs: '',
  };
}

export function createBlankRecibosVerdesDraft(
  transmitente?: Partial<
    Pick<
      RecibosVerdesDraft,
      'transmitenteNome' | 'transmitenteNif' | 'transmitenteMorada' | 'transmitenteAtividade'
    >
  >
): RecibosVerdesDraft {
  return {
    tipoDocumento: 'Fatura-Recibo',
    dataPrestacao: todayIso(),
    motivoEmissao: RECIBOS_VERDES_MOTIVO_EMISSAO,
    transmitenteNome: transmitente?.transmitenteNome ?? '',
    transmitenteNif: transmitente?.transmitenteNif ?? '',
    transmitenteMorada: transmitente?.transmitenteMorada ?? '',
    transmitenteAtividade: transmitente?.transmitenteAtividade ?? '',
    adquirentePais: 'Portugal',
    adquirenteNome: '',
    adquirenteNif: '',
    adquirenteMorada: '',
    adquirenteCodigoPostal: '',
    adquirenteLocalidade: '',
    observacoes: '',
    linhas: [],
    baseIncidenciaIrs: RECIBOS_VERDES_BASE_IRS,
    retencaoFonteIrs: '',
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

export function parseIvaPercent(taxaIva: string): number {
  const m = taxaIva.match(/^(\d+(?:[.,]\d+)?)\s*%/);
  if (!m) return 0;
  return parsePtMoney(m[1]);
}

export function lineTotalComImposto(linha: RecibosVerdesDraftLinha): number {
  const q = parsePtMoney(linha.quantidade) || 1;
  const unit = parsePtMoney(linha.precoUnitarioSemIva);
  const disc = parsePtMoney(linha.desconto);
  const base = Math.max(0, q * unit - disc);
  return base + (base * parseIvaPercent(linha.taxaIva)) / 100;
}

export function summarizeRecibosVerdesDraft(draft: RecibosVerdesDraft): {
  valorIliquido: number;
  valorIva: number;
  totalDocumento: number;
  totalPagar: number;
  porTaxa: Array<{ taxa: string; motivo: string; valorTributavel: number; valorIva: number }>;
} {
  let valorIliquido = 0;
  let valorIva = 0;
  const map = new Map<string, { taxa: string; motivo: string; valorTributavel: number; valorIva: number }>();

  for (const linha of draft.linhas) {
    const q = parsePtMoney(linha.quantidade) || 1;
    const unit = parsePtMoney(linha.precoUnitarioSemIva);
    const disc = parsePtMoney(linha.desconto);
    const base = Math.max(0, q * unit - disc);
    const ivaPct = parseIvaPercent(linha.taxaIva);
    const iva = (base * ivaPct) / 100;
    valorIliquido += base;
    valorIva += iva;

    const label = `${formatPtMoney(ivaPct)}%`;
    const key = `${label}|${linha.motivoIsencao || ''}`;
    const prev = map.get(key) ?? {
      taxa: label,
      motivo: linha.motivoIsencao || '',
      valorTributavel: 0,
      valorIva: 0,
    };
    prev.valorTributavel += base;
    prev.valorIva += iva;
    map.set(key, prev);
  }

  const totalDocumento = valorIliquido + valorIva;
  return {
    valorIliquido,
    valorIva,
    totalDocumento,
    totalPagar: totalDocumento,
    porTaxa: Array.from(map.values()),
  };
}

export function draftHasAdquirente(draft: RecibosVerdesDraft): boolean {
  return Boolean(draft.adquirenteNome.trim() && draft.adquirenteNif.trim());
}

export function draftHasProdutos(draft: RecibosVerdesDraft): boolean {
  return draft.linhas.some(
    (l) => l.descricao.trim() && parsePtMoney(l.precoUnitarioSemIva) > 0
  );
}

export function draftShowsIrsSection(draft: RecibosVerdesDraft): boolean {
  return draftHasAdquirente(draft) && draftHasProdutos(draft);
}

export function formatAdquirenteMoradaCompleta(draft: RecibosVerdesDraft): string {
  const parts = [
    draft.adquirenteMorada.trim(),
    [draft.adquirenteCodigoPostal.trim(), draft.adquirenteLocalidade.trim()].filter(Boolean).join(' '),
    draft.adquirentePais.trim(),
  ].filter(Boolean);
  return parts.join(', ');
}

export const ADMIN_MGMT_MODULE_KEY = 'admin_mgmt';
export const ADMIN_MGMT_MODULE_NAME = 'Gestão Administrativa';

export const ADMIN_MGMT_VENCIMENTO_ORIGENS = [
  'seguro',
  'contrato',
  'fatura',
  'manutencao',
  'seguranca_social',
  'irs',
  'iva',
  'recibo_verde',
  'outro',
] as const;

export type AdminMgmtVencimentoOrigem = (typeof ADMIN_MGMT_VENCIMENTO_ORIGENS)[number];

export const ADMIN_MGMT_VENCIMENTO_STATUSES = ['pendente', 'resolvido', 'atrasado'] as const;
export type AdminMgmtVencimentoStatus = (typeof ADMIN_MGMT_VENCIMENTO_STATUSES)[number];

export const ADMIN_MGMT_SEGURO_TIPO_AUTOMOVEL = 'Automóvel';
export const ADMIN_MGMT_MAX_APOlices = 3;
export const ADMIN_MGMT_MAX_FATURA_ANEXOS = 3;

export const ADMIN_MGMT_FATURA_TIPOS = [
  'fatura',
  'fatura_recibo',
  'recibo_verde',
  'nota_credito',
  'outro',
] as const;

export const ADMIN_MGMT_FATURA_PAGAMENTO_STATUSES = [
  'pendente',
  'pago',
  'parcial',
  'cancelado',
] as const;

export const ADMIN_MGMT_FATURA_METODOS_PAGAMENTO = [
  'transferencia',
  'mb',
  'multibanco',
  'numerario',
  'cartao',
  'conta_corrente',
  'outro',
] as const;

export const ADMIN_MGMT_FATURA_ANEXO_MIME_TYPES = ['application/pdf'] as const;

export interface AdminMgmtFaturaAnexo {
  id: string;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export const DEFAULT_ADMIN_MGMT_SEGURADORAS = [
  'Generali Tranquilidade',
  'Fidelidade',
  'Allianz',
  'AXA',
  'Liberty Seguros',
] as const;

export const DEFAULT_ADMIN_MGMT_TIPOS_PRODUTO = [
  ADMIN_MGMT_SEGURO_TIPO_AUTOMOVEL,
  'Multirriscos',
  'Responsabilidade Civil',
  'Saúde',
  'Viagem',
  'Outro',
] as const;

export const ADMIN_MGMT_APOlice_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export interface AdminMgmtApoliceFile {
  id: string;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function isAdminMgmtSeguroTipoAutomovel(tipoProduto: string): boolean {
  const normalized = tipoProduto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized === 'automovel';
}

export const ADMIN_MGMT_SEGURO_OBJETO_TIPOS = ['viatura', 'pessoa', 'imovel', 'outro'] as const;
export const ADMIN_MGMT_SEGURO_PERIODICIDADES = ['mensal', 'trimestral', 'semestral', 'anual'] as const;
export const ADMIN_MGMT_SEGURO_PAGAMENTO_STATUSES = ['pago', 'pendente', 'em_atraso'] as const;

export const ADMIN_MGMT_CONTRATO_TIPOS = [
  'cliente',
  'fornecedor',
  'arrendamento',
  'prestacao_servicos',
  'outro',
] as const;
export const ADMIN_MGMT_CONTRATO_PERIODICIDADES = ['unico', 'mensal', 'trimestral', 'anual'] as const;
export const ADMIN_MGMT_CONTRATO_STATUSES = ['ativo', 'em_renovacao', 'terminado'] as const;

export const ADMIN_MGMT_FISCAL_STATUSES = ['pago', 'pendente', 'em_atraso'] as const;
export const ADMIN_MGMT_IVA_REGIMES = ['mensal', 'trimestral'] as const;
export const ADMIN_MGMT_IVA_STATUSES = ['entregue', 'pendente', 'pago', 'em_atraso'] as const;

export const ADMIN_MGMT_IRS_TIPOS = [
  'retencao_trabalho_dependente',
  'retencao_independentes',
  'pagamento_por_conta',
] as const;

export const DEFAULT_ADMIN_MGMT_ALERT_DAYS = 15;

export function getAdminMgmtVencimentoOrigemLabel(origem: string): string {
  const labels: Record<string, string> = {
    seguro: 'Seguro',
    fatura: 'Fatura',
    contrato: 'Contrato',
    manutencao: 'Manutenção',
    seguranca_social: 'Segurança Social',
    irs: 'IRS',
    iva: 'IVA',
    recibo_verde: 'Recibo Verde',
    outro: 'Outro',
  };
  return labels[origem] ?? origem;
}

export function getAdminMgmtVencimentoStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pendente: 'Pendente',
    resolvido: 'Resolvido',
    atrasado: 'Atrasado',
  };
  return labels[status] ?? status;
}

/** Rota do dashboard para a origem de um vencimento. */
export function getAdminMgmtVencimentoHref(origemTipo: string): string {
  const base = '/dashboard/admin-mgmt';
  const routes: Record<string, string> = {
    seguro: `${base}/seguros`,
    contrato: `${base}/contratos`,
    fatura: `${base}/faturas`,
    seguranca_social: `${base}/seguranca-social`,
    irs: `${base}/irs`,
    iva: `${base}/iva`,
    recibo_verde: `${base}/recibos-verdes`,
    manutencao: base,
    outro: base,
  };
  return routes[origemTipo] ?? base;
}

export function vencimentoUrgencyClass(dueDate: string | Date, status: string): string {
  if (status === 'resolvido') return 'text-green-700 bg-green-50 border-green-200';
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0 || status === 'atrasado') return 'text-red-700 bg-red-50 border-red-200';
  if (days <= 7) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-slate-700 bg-slate-50 border-slate-200';
}

/** Valor monetário PT: 28,70€ */
export function formatAdminMgmtMoney(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return null;
  return `${amount.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;
}

/** Título curto do alerta (sem sufixo «renovação», etc.). */
export function formatAdminMgmtAlertTitle(descricao: string): string {
  return descricao
    .replace(/\s*—\s*renovação\s*$/i, '')
    .replace(/\s*—\s*pré-aviso\s*$/i, '')
    .trim();
}

/** Assunto do email/WhatsApp: «Alerta de Vencimento Seguro Automóvel». */
export function formatAdminMgmtAlertSubject(descricao: string, origemTipo: string): string {
  const title = formatAdminMgmtAlertTitle(descricao);
  const seguroMatch = title.match(/^Seguro\s+([^—]+)/i);
  if (seguroMatch) {
    return `Alerta de Vencimento Seguro ${seguroMatch[1].trim()}`;
  }
  const origem = getAdminMgmtVencimentoOrigemLabel(origemTipo);
  const withoutOrigemPrefix = title.replace(new RegExp(`^${origem}\\s*—?\\s*`, 'i'), '').trim();
  return withoutOrigemPrefix
    ? `Alerta de Vencimento ${origem} ${withoutOrigemPrefix.split('—')[0]?.trim() ?? ''}`.trim()
    : `Alerta de Vencimento ${origem}`;
}

/** Fatura-recibo / recibo verde are settled on issue — not open AR. */
export function isAdminMgmtAutoPaidDocumento(tipoDocumento: string): boolean {
  return tipoDocumento === 'fatura_recibo' || tipoDocumento === 'recibo_verde';
}

export function defaultEstadoPagamentoForTipoDocumento(
  tipoDocumento: string
): 'pago' | 'pendente' {
  return isAdminMgmtAutoPaidDocumento(tipoDocumento) ? 'pago' : 'pendente';
}

export function getAdminMgmtFaturaTipoLabel(tipo: string): string {
  const labels: Record<string, string> = {
    fatura: 'Fatura',
    fatura_recibo: 'Fatura-Recibo',
    recibo_verde: 'Recibo Verde',
    nota_credito: 'Nota de Crédito',
    outro: 'Outro',
  };
  return labels[tipo] ?? tipo;
}

export function getAdminMgmtFaturaPagamentoLabel(status: string): string {
  const labels: Record<string, string> = {
    pendente: 'Pendente',
    pago: 'Pago',
    parcial: 'Parcial',
    cancelado: 'Cancelado',
  };
  return labels[status] ?? status;
}

export function getAdminMgmtFaturaMetodoPagamentoLabel(metodo: string): string {
  const labels: Record<string, string> = {
    transferencia: 'Transferência',
    mb: 'MB Way',
    multibanco: 'Multibanco',
    numerario: 'Numerário',
    cartao: 'Cartão',
    conta_corrente: 'Conta corrente',
    outro: 'Outro',
  };
  return labels[metodo] ?? metodo;
}

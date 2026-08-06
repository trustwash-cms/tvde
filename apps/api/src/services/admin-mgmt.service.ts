import { prisma, Prisma } from '@tvde/database';
import {
  deleteAdminMgmtAttachmentFile,
  saveAdminMgmtAttachmentFile,
} from './admin-mgmt-attachment-storage.service';
import { assertTenantStorageQuota } from './tenant-storage.service';
import {
  deleteAdminMgmtVencimentoByOrigem,
  upsertAdminMgmtVencimento,
} from './admin-mgmt-vencimentos.service';
import { getAdminMgmtSettings } from './admin-mgmt-settings.service';

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(n) ? new Prisma.Decimal(n) : null;
}

function mapDecimal(value: Prisma.Decimal | null | undefined): string | null {
  return value?.toString() ?? null;
}

function mapDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

async function scopeWhere(id: string, workspaceId: string, tenantId: string) {
  return { id, workspaceId, tenantId };
}

// ─── Seguros (delegado) ─────────────────────────────────────────────────────

export {
  listAdminMgmtSeguros,
  createAdminMgmtSeguro,
  updateAdminMgmtSeguro,
  deleteAdminMgmtSeguro,
  uploadSeguroApolice,
  deleteSeguroApolice,
  getSeguroApoliceForDownload,
} from './admin-mgmt-seguro.service';

// ─── Clientes + Faturas (delegado) ──────────────────────────────────────────

export {
  listAdminMgmtClientes,
  getAdminMgmtCliente,
  lookupAdminMgmtClientes,
  createAdminMgmtCliente,
  updateAdminMgmtCliente,
  deleteAdminMgmtCliente,
  importAdminMgmtClienteFromSource,
  createAdminMgmtClienteLancamento,
  deleteAdminMgmtClienteLancamento,
  previewAdminMgmtClienteLancamento,
} from './admin-mgmt-cliente.service';

export {
  previewRecibosVerdesCsvImport,
  confirmRecibosVerdesCsvImport,
  listRecibosVerdesImportacoes,
} from './admin-mgmt-recibos-verdes-import.service';

export { syncAdminMgmtFromBillingInvoice } from './admin-mgmt-moloni-sync.service';

export {
  listAdminMgmtFaturas,
  getAdminMgmtFatura,
  createAdminMgmtFatura,
  updateAdminMgmtFatura,
  markAdminMgmtFaturaPaid,
  markAdminMgmtFaturaPending,
  deleteAdminMgmtFatura,
  bulkMarkAdminMgmtFaturasPaid,
  bulkMarkAdminMgmtFaturasPending,
  bulkDeleteAdminMgmtFaturas,
  uploadFaturaAnexo,
  deleteFaturaAnexo,
  getFaturaAnexoForDownload,
} from './admin-mgmt-fatura.service';

// ─── Contratos ──────────────────────────────────────────────────────────────

function mapContrato(row: Prisma.AdminMgmtContratoGetPayload<object>) {
  return {
    id: row.id,
    tipo: row.tipo,
    contraparteNome: row.contraparteNome,
    contraparteNif: row.contraparteNif,
    objeto: row.objeto,
    valor: mapDecimal(row.valor),
    periodicidade: row.periodicidade,
    dataInicio: mapDate(row.dataInicio),
    dataFim: mapDate(row.dataFim),
    renovacaoAutomatica: row.renovacaoAutomatica,
    preAvisoDenunciaDias: row.preAvisoDenunciaDias,
    status: row.status,
    hasAttachment: Boolean(row.attachmentStorageKey),
    attachmentFileName: row.attachmentFileName,
    notas: row.notas,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function syncContratoVencimento(
  row: Prisma.AdminMgmtContratoGetPayload<object>,
  workspaceId: string,
  tenantId: string
) {
  if (!row.dataFim) {
    await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'contrato', row.id);
    return;
  }
  let due = row.dataFim;
  let descricao = `Contrato ${row.contraparteNome} — fim`;
  if (row.preAvisoDenunciaDias && row.preAvisoDenunciaDias > 0) {
    due = new Date(row.dataFim);
    due.setDate(due.getDate() - row.preAvisoDenunciaDias);
    descricao = `Contrato ${row.contraparteNome} — prazo denúncia`;
  }
  await upsertAdminMgmtVencimento({
    tenantId,
    workspaceId,
    origemTipo: 'contrato',
    origemId: row.id,
    descricao,
    dataVencimento: due,
    valorAssociado: row.valor ? Number(row.valor) : null,
  });
}

export async function listAdminMgmtContratos(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtContrato.findMany({
    where: { workspaceId, tenantId },
    orderBy: [{ dataFim: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map(mapContrato);
}

export async function createAdminMgmtContrato(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const dataInicio = parseDate(String(input.dataInicio ?? ''));
  if (!dataInicio) throw new Error('Data início é obrigatória');

  const row = await prisma.adminMgmtContrato.create({
    data: {
      tenantId,
      workspaceId,
      tipo: String(input.tipo ?? 'outro'),
      contraparteNome: String(input.contraparteNome ?? '').trim(),
      contraparteNif: input.contraparteNif ? String(input.contraparteNif).trim() : null,
      objeto: input.objeto ? String(input.objeto).trim() : null,
      valor: parseDecimal(input.valor),
      periodicidade: String(input.periodicidade ?? 'unico'),
      dataInicio,
      dataFim: parseDate(String(input.dataFim ?? '')),
      renovacaoAutomatica: Boolean(input.renovacaoAutomatica),
      preAvisoDenunciaDias: input.preAvisoDenunciaDias
        ? Number(input.preAvisoDenunciaDias)
        : null,
      status: String(input.status ?? 'ativo'),
      notas: input.notas ? String(input.notas).trim() : null,
    },
  });
  await syncContratoVencimento(row, workspaceId, tenantId);
  return mapContrato(row);
}

export async function updateAdminMgmtContrato(
  id: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const existing = await prisma.adminMgmtContrato.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return null;
  const row = await prisma.adminMgmtContrato.update({
    where: { id },
    data: {
      ...(input.contraparteNome !== undefined
        ? { contraparteNome: String(input.contraparteNome).trim() }
        : {}),
      ...(input.dataFim !== undefined ? { dataFim: parseDate(String(input.dataFim ?? '')) } : {}),
      ...(input.preAvisoDenunciaDias !== undefined
        ? {
            preAvisoDenunciaDias: input.preAvisoDenunciaDias
              ? Number(input.preAvisoDenunciaDias)
              : null,
          }
        : {}),
      ...(input.status !== undefined ? { status: String(input.status) } : {}),
    },
  });
  await syncContratoVencimento(row, workspaceId, tenantId);
  return mapContrato(row);
}

export async function deleteAdminMgmtContrato(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtContrato.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return false;
  if (existing.attachmentStorageKey) await deleteAdminMgmtAttachmentFile(existing.attachmentStorageKey);
  await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'contrato', id);
  await prisma.adminMgmtContrato.delete({ where: { id } });
  return true;
}

// ─── Segurança Social ───────────────────────────────────────────────────────

function mapSegurancaSocial(row: Prisma.AdminMgmtSegurancaSocialGetPayload<object>) {
  return {
    id: row.id,
    mesReferencia: mapDate(row.mesReferencia),
    valorTrabalhadores: mapDecimal(row.valorTrabalhadores),
    valorEntidadePatronal: mapDecimal(row.valorEntidadePatronal),
    valorTotalGuia: mapDecimal(row.valorTotalGuia),
    dataLimitePagamento: mapDate(row.dataLimitePagamento),
    numeroGuia: row.numeroGuia,
    status: row.status,
    hasAttachment: Boolean(row.attachmentStorageKey),
    attachmentFileName: row.attachmentFileName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function syncSegurancaSocialVencimento(
  row: Prisma.AdminMgmtSegurancaSocialGetPayload<object>,
  workspaceId: string,
  tenantId: string
) {
  const mes = mapDate(row.mesReferencia) ?? '';
  await upsertAdminMgmtVencimento({
    tenantId,
    workspaceId,
    origemTipo: 'seguranca_social',
    origemId: row.id,
    descricao: `Segurança Social — guia ${mes}`,
    dataVencimento: row.dataLimitePagamento,
    valorAssociado: row.valorTotalGuia ? Number(row.valorTotalGuia) : null,
  });
}

export async function listAdminMgmtSegurancaSocial(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtSegurancaSocial.findMany({
    where: { workspaceId, tenantId },
    orderBy: [{ dataLimitePagamento: 'desc' }],
  });
  return rows.map(mapSegurancaSocial);
}

export async function createAdminMgmtSegurancaSocial(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const mes = parseDate(String(input.mesReferencia ?? ''));
  const limite = parseDate(String(input.dataLimitePagamento ?? ''));
  if (!mes || !limite) throw new Error('Mês referência e data limite são obrigatórios');

  const row = await prisma.adminMgmtSegurancaSocial.create({
    data: {
      tenantId,
      workspaceId,
      mesReferencia: mes,
      valorTrabalhadores: parseDecimal(input.valorTrabalhadores),
      valorEntidadePatronal: parseDecimal(input.valorEntidadePatronal),
      valorTotalGuia: parseDecimal(input.valorTotalGuia),
      dataLimitePagamento: limite,
      numeroGuia: input.numeroGuia ? String(input.numeroGuia).trim() : null,
      status: String(input.status ?? 'pendente'),
    },
  });
  await syncSegurancaSocialVencimento(row, workspaceId, tenantId);
  return mapSegurancaSocial(row);
}

export async function deleteAdminMgmtSegurancaSocial(
  id: string,
  workspaceId: string,
  tenantId: string
) {
  const existing = await prisma.adminMgmtSegurancaSocial.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return false;
  await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'seguranca_social', id);
  await prisma.adminMgmtSegurancaSocial.delete({ where: { id } });
  return true;
}

// ─── IRS ────────────────────────────────────────────────────────────────────

function mapIrs(row: Prisma.AdminMgmtIrsEmpresaGetPayload<object>) {
  return {
    id: row.id,
    tipo: row.tipo,
    periodoReferencia: row.periodoReferencia,
    valor: mapDecimal(row.valor),
    dataLimiteEntrega: mapDate(row.dataLimiteEntrega),
    numeroGuiaReferencia: row.numeroGuiaReferencia,
    status: row.status,
    hasAttachment: Boolean(row.attachmentStorageKey),
    attachmentFileName: row.attachmentFileName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAdminMgmtIrs(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtIrsEmpresa.findMany({
    where: { workspaceId, tenantId },
    orderBy: [{ dataLimiteEntrega: 'desc' }],
  });
  return rows.map(mapIrs);
}

export async function createAdminMgmtIrs(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const limite = parseDate(String(input.dataLimiteEntrega ?? ''));
  if (!limite) throw new Error('Data limite de entrega é obrigatória');
  const row = await prisma.adminMgmtIrsEmpresa.create({
    data: {
      tenantId,
      workspaceId,
      tipo: String(input.tipo ?? 'retencao_trabalho_dependente'),
      periodoReferencia: String(input.periodoReferencia ?? '').trim(),
      valor: parseDecimal(input.valor) ?? new Prisma.Decimal(0),
      dataLimiteEntrega: limite,
      numeroGuiaReferencia: input.numeroGuiaReferencia
        ? String(input.numeroGuiaReferencia).trim()
        : null,
      status: String(input.status ?? 'pendente'),
    },
  });
  await upsertAdminMgmtVencimento({
    tenantId,
    workspaceId,
    origemTipo: 'irs',
    origemId: row.id,
    descricao: `IRS — ${row.periodoReferencia}`,
    dataVencimento: row.dataLimiteEntrega,
    valorAssociado: Number(row.valor),
  });
  return mapIrs(row);
}

export async function deleteAdminMgmtIrs(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtIrsEmpresa.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return false;
  await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'irs', id);
  await prisma.adminMgmtIrsEmpresa.delete({ where: { id } });
  return true;
}

// ─── IVA ────────────────────────────────────────────────────────────────────

function mapIva(row: Prisma.AdminMgmtIvaGetPayload<object>) {
  return {
    id: row.id,
    regime: row.regime,
    periodoReferencia: row.periodoReferencia,
    ivaLiquidado: mapDecimal(row.ivaLiquidado),
    ivaDedutivel: mapDecimal(row.ivaDedutivel),
    ivaApurado: mapDecimal(row.ivaApurado),
    dataLimiteEntregaDeclaracao: mapDate(row.dataLimiteEntregaDeclaracao),
    dataLimitePagamento: mapDate(row.dataLimitePagamento),
    status: row.status,
    hasAttachment: Boolean(row.attachmentStorageKey),
    attachmentFileName: row.attachmentFileName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAdminMgmtIva(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtIva.findMany({
    where: { workspaceId, tenantId },
    orderBy: [{ dataLimitePagamento: 'desc' }],
  });
  return rows.map(mapIva);
}

export async function createAdminMgmtIva(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const limite = parseDate(String(input.dataLimitePagamento ?? ''));
  if (!limite) throw new Error('Data limite de pagamento é obrigatória');
  const row = await prisma.adminMgmtIva.create({
    data: {
      tenantId,
      workspaceId,
      regime: String(input.regime ?? 'trimestral'),
      periodoReferencia: String(input.periodoReferencia ?? '').trim(),
      ivaLiquidado: parseDecimal(input.ivaLiquidado),
      ivaDedutivel: parseDecimal(input.ivaDedutivel),
      ivaApurado: parseDecimal(input.ivaApurado),
      dataLimiteEntregaDeclaracao: parseDate(String(input.dataLimiteEntregaDeclaracao ?? '')),
      dataLimitePagamento: limite,
      status: String(input.status ?? 'pendente'),
    },
  });
  await upsertAdminMgmtVencimento({
    tenantId,
    workspaceId,
    origemTipo: 'iva',
    origemId: row.id,
    descricao: `IVA — ${row.periodoReferencia}`,
    dataVencimento: row.dataLimitePagamento,
    valorAssociado: row.ivaApurado ? Number(row.ivaApurado) : null,
  });
  return mapIva(row);
}

export async function deleteAdminMgmtIva(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtIva.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return false;
  await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'iva', id);
  await prisma.adminMgmtIva.delete({ where: { id } });
  return true;
}

// ─── Despesas pessoal ───────────────────────────────────────────────────────

function mapDespesaPessoal(row: Prisma.AdminMgmtDespesaPessoalGetPayload<object>) {
  return {
    id: row.id,
    colaboradorNome: row.colaboradorNome,
    colaboradorNiss: row.colaboradorNiss,
    mesReferencia: mapDate(row.mesReferencia),
    vencimentoBase: mapDecimal(row.vencimentoBase),
    subsidioAlimentacao: mapDecimal(row.subsidioAlimentacao),
    subsidioFerias: mapDecimal(row.subsidioFerias),
    subsidioNatal: mapDecimal(row.subsidioNatal),
    outrosAbonos: mapDecimal(row.outrosAbonos),
    retencaoIrs: mapDecimal(row.retencaoIrs),
    retencaoSsTrabalhador: mapDecimal(row.retencaoSsTrabalhador),
    ssEntidadePatronal: mapDecimal(row.ssEntidadePatronal),
    valorLiquidoPago: mapDecimal(row.valorLiquidoPago),
    dataPagamento: mapDate(row.dataPagamento),
    hasAttachment: Boolean(row.attachmentStorageKey),
    attachmentFileName: row.attachmentFileName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAdminMgmtDespesasPessoal(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtDespesaPessoal.findMany({
    where: { workspaceId, tenantId },
    orderBy: [{ mesReferencia: 'desc' }],
  });
  return rows.map(mapDespesaPessoal);
}

export async function createAdminMgmtDespesaPessoal(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const mes = parseDate(String(input.mesReferencia ?? ''));
  if (!mes) throw new Error('Mês referência é obrigatório');
  const row = await prisma.adminMgmtDespesaPessoal.create({
    data: {
      tenantId,
      workspaceId,
      colaboradorNome: String(input.colaboradorNome ?? '').trim(),
      colaboradorNiss: input.colaboradorNiss ? String(input.colaboradorNiss).trim() : null,
      mesReferencia: mes,
      vencimentoBase: parseDecimal(input.vencimentoBase),
      subsidioAlimentacao: parseDecimal(input.subsidioAlimentacao),
      subsidioFerias: parseDecimal(input.subsidioFerias),
      subsidioNatal: parseDecimal(input.subsidioNatal),
      outrosAbonos: parseDecimal(input.outrosAbonos),
      retencaoIrs: parseDecimal(input.retencaoIrs),
      retencaoSsTrabalhador: parseDecimal(input.retencaoSsTrabalhador),
      ssEntidadePatronal: parseDecimal(input.ssEntidadePatronal),
      valorLiquidoPago: parseDecimal(input.valorLiquidoPago),
      dataPagamento: parseDate(String(input.dataPagamento ?? '')),
    },
  });
  return mapDespesaPessoal(row);
}

export async function deleteAdminMgmtDespesaPessoal(
  id: string,
  workspaceId: string,
  tenantId: string
) {
  const existing = await prisma.adminMgmtDespesaPessoal.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return false;
  await prisma.adminMgmtDespesaPessoal.delete({ where: { id } });
  return true;
}

// ─── Recibos verdes ─────────────────────────────────────────────────────────

function mapReciboVerde(row: Prisma.AdminMgmtReciboVerdeGetPayload<object>) {
  return {
    id: row.id,
    prestadorNome: row.prestadorNome,
    prestadorNif: row.prestadorNif,
    numeroRecibo: row.numeroRecibo,
    dataEmissao: mapDate(row.dataEmissao),
    descricaoServico: row.descricaoServico,
    valorBruto: mapDecimal(row.valorBruto),
    taxaRetencaoIrs: mapDecimal(row.taxaRetencaoIrs),
    valorRetencaoIrs: mapDecimal(row.valorRetencaoIrs),
    isentoSs: row.isentoSs,
    valorSs: mapDecimal(row.valorSs),
    valorLiquido: mapDecimal(row.valorLiquido),
    clienteAssociado: row.clienteAssociado,
    hasAttachment: Boolean(row.attachmentStorageKey),
    attachmentFileName: row.attachmentFileName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAdminMgmtRecibosVerdes(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtReciboVerde.findMany({
    where: { workspaceId, tenantId },
    orderBy: [{ dataEmissao: 'desc' }],
  });
  return rows.map(mapReciboVerde);
}

export async function createAdminMgmtReciboVerde(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const dataEmissao = parseDate(String(input.dataEmissao ?? ''));
  if (!dataEmissao) throw new Error('Data emissão é obrigatória');
  const row = await prisma.adminMgmtReciboVerde.create({
    data: {
      tenantId,
      workspaceId,
      prestadorNome: String(input.prestadorNome ?? '').trim(),
      prestadorNif: input.prestadorNif ? String(input.prestadorNif).trim() : null,
      numeroRecibo: input.numeroRecibo ? String(input.numeroRecibo).trim() : null,
      dataEmissao,
      descricaoServico: input.descricaoServico ? String(input.descricaoServico).trim() : null,
      valorBruto: parseDecimal(input.valorBruto),
      taxaRetencaoIrs: parseDecimal(input.taxaRetencaoIrs),
      valorRetencaoIrs: parseDecimal(input.valorRetencaoIrs),
      isentoSs: Boolean(input.isentoSs),
      valorSs: parseDecimal(input.valorSs),
      valorLiquido: parseDecimal(input.valorLiquido),
      clienteAssociado: input.clienteAssociado ? String(input.clienteAssociado).trim() : null,
    },
  });
  return mapReciboVerde(row);
}

export async function deleteAdminMgmtReciboVerde(
  id: string,
  workspaceId: string,
  tenantId: string
) {
  const existing = await prisma.adminMgmtReciboVerde.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return false;
  await prisma.adminMgmtReciboVerde.delete({ where: { id } });
  return true;
}

export async function uploadAdminMgmtAttachment(
  entityType: string,
  id: string,
  workspaceId: string,
  tenantId: string,
  input: { fileName: string; buffer: Buffer }
) {
  await assertTenantStorageQuota(prisma, tenantId, input.buffer.length);

  const storageKey = `${tenantId}/${entityType}/${id}/${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await saveAdminMgmtAttachmentFile(storageKey, input.buffer);

  const data = { attachmentStorageKey: storageKey, attachmentFileName: input.fileName };
  switch (entityType) {
    case 'seguros':
      await prisma.adminMgmtSeguro.updateMany({ where: { id, workspaceId, tenantId }, data });
      break;
    case 'contratos':
      await prisma.adminMgmtContrato.updateMany({ where: { id, workspaceId, tenantId }, data });
      break;
    case 'seguranca-social':
      await prisma.adminMgmtSegurancaSocial.updateMany({ where: { id, workspaceId, tenantId }, data });
      break;
    case 'irs':
      await prisma.adminMgmtIrsEmpresa.updateMany({ where: { id, workspaceId, tenantId }, data });
      break;
    case 'iva':
      await prisma.adminMgmtIva.updateMany({ where: { id, workspaceId, tenantId }, data });
      break;
    case 'despesas-pessoal':
      await prisma.adminMgmtDespesaPessoal.updateMany({ where: { id, workspaceId, tenantId }, data });
      break;
    case 'recibos-verdes':
      await prisma.adminMgmtReciboVerde.updateMany({ where: { id, workspaceId, tenantId }, data });
      break;
    default:
      throw new Error('Tipo de entidade inválido');
  }
  return { storageKey, fileName: input.fileName };
}

export { getAdminMgmtSettings } from './admin-mgmt-settings.service';
export { updateAdminMgmtSettings } from './admin-mgmt-settings.service';

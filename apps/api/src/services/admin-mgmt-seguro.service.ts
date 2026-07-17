import { randomUUID } from 'node:crypto';
import { prisma, Prisma } from '@tvde/database';
import {
  ADMIN_MGMT_APOlice_MIME_TYPES,
  ADMIN_MGMT_MAX_APOlices,
  type AdminMgmtApoliceFile,
  isAdminMgmtSeguroTipoAutomovel,
  normalizeLicensePlate,
} from '@tvde/shared';
import {
  deleteAdminMgmtAttachmentFile,
  saveAdminMgmtAttachmentFile,
  buildAdminMgmtStorageKey,
} from './admin-mgmt-attachment-storage.service';
import { assertTenantStorageQuota } from './tenant-storage.service';
import {
  deleteAdminMgmtVencimentoByOrigem,
  upsertAdminMgmtVencimento,
} from './admin-mgmt-vencimentos.service';

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

function parseApolicesJson(value: unknown): AdminMgmtApoliceFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as AdminMgmtApoliceFile)
    .filter((item) => typeof item.id === 'string' && typeof item.storageKey === 'string');
}

function mapSeguro(row: Prisma.AdminMgmtSeguroGetPayload<object>) {
  const apolices = parseApolicesJson(row.apolicesJson);
  return {
    id: row.id,
    seguradora: row.seguradora,
    tipoProduto: row.tipoProduto,
    matricula: row.matricula,
    opcaoCobertura: row.opcaoCobertura,
    numeroApolice: row.numeroApolice,
    entidadeCobradora: row.entidadeCobradora,
    periodicidadePagamento: row.periodicidadePagamento,
    dataInicioPeriodo: mapDate(row.dataInicioPeriodo),
    dataFimPeriodo: mapDate(row.dataFimPeriodo),
    premioComercial: mapDecimal(row.premioComercial),
    custosFracionamento: mapDecimal(row.custosFracionamento),
    custosGestaoSeguro: mapDecimal(row.custosGestaoSeguro),
    impostoSelo: mapDecimal(row.impostoSelo),
    outrosEncargosTaxas: mapDecimal(row.outrosEncargosTaxas),
    totalPago: mapDecimal(row.totalPago),
    numeroFaturaRecibo: row.numeroFaturaRecibo,
    dataEmissao: mapDate(row.dataEmissao),
    assistenciaViagem: row.assistenciaViagem,
    capitalRc: mapDecimal(row.capitalRc),
    coberturaRoubo: row.coberturaRoubo,
    statusPagamento: row.statusPagamento,
    apolices,
    apoliceCount: apolices.length,
    notas: row.notas,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveMatricula(tipoProduto: string, matricula: unknown): string | null {
  if (!isAdminMgmtSeguroTipoAutomovel(tipoProduto)) return null;
  if (typeof matricula !== 'string' || !matricula.trim()) {
    throw new Error('Matrícula obrigatória para seguro Automóvel');
  }
  const normalized = normalizeLicensePlate({ licensePlate: matricula });
  return normalized.licensePlate;
}

async function syncSeguroVencimento(
  row: Prisma.AdminMgmtSeguroGetPayload<object>,
  workspaceId: string,
  tenantId: string
) {
  const label =
    row.matricula?.trim() ||
    row.numeroApolice?.trim() ||
    row.seguradora?.trim() ||
    row.tipoProduto;
  await upsertAdminMgmtVencimento({
    tenantId,
    workspaceId,
    origemTipo: 'seguro',
    origemId: row.id,
    descricao: `Seguro ${row.tipoProduto}${label ? ` — ${label}` : ''} — renovação`,
    dataVencimento: row.dataFimPeriodo,
    valorAssociado: row.totalPago ? Number(row.totalPago) : null,
  });
}

export async function listAdminMgmtSeguros(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtSeguro.findMany({
    where: { workspaceId, tenantId },
    orderBy: [{ dataFimPeriodo: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map(mapSeguro);
}

export async function createAdminMgmtSeguro(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const dataFim = parseDate(String(input.dataFimPeriodo ?? ''));
  if (!dataFim) throw new Error('Data fim do período é obrigatória');

  const tipoProduto = String(input.tipoProduto ?? '').trim();
  if (!tipoProduto) throw new Error('Tipo de produto é obrigatório');

  const seguradora = String(input.seguradora ?? '').trim();
  if (!seguradora) throw new Error('Seguradora é obrigatória');

  const matricula = resolveMatricula(tipoProduto, input.matricula);

  const row = await prisma.adminMgmtSeguro.create({
    data: {
      tenantId,
      workspaceId,
      seguradora,
      tipoProduto,
      matricula,
      objetoTipo: isAdminMgmtSeguroTipoAutomovel(tipoProduto) ? 'viatura' : 'outro',
      opcaoCobertura: input.opcaoCobertura ? String(input.opcaoCobertura).trim() : null,
      numeroApolice: input.numeroApolice ? String(input.numeroApolice).trim() : null,
      entidadeCobradora: input.entidadeCobradora ? String(input.entidadeCobradora).trim() : null,
      periodicidadePagamento: String(input.periodicidadePagamento ?? 'mensal'),
      dataInicioPeriodo: parseDate(String(input.dataInicioPeriodo ?? '')),
      dataFimPeriodo: dataFim,
      premioComercial: parseDecimal(input.premioComercial),
      custosFracionamento: parseDecimal(input.custosFracionamento),
      custosGestaoSeguro: parseDecimal(input.custosGestaoSeguro),
      impostoSelo: parseDecimal(input.impostoSelo),
      outrosEncargosTaxas: parseDecimal(input.outrosEncargosTaxas),
      totalPago: parseDecimal(input.totalPago),
      numeroFaturaRecibo: input.numeroFaturaRecibo ? String(input.numeroFaturaRecibo).trim() : null,
      dataEmissao: parseDate(String(input.dataEmissao ?? '')),
      assistenciaViagem: Boolean(input.assistenciaViagem),
      capitalRc: parseDecimal(input.capitalRc),
      coberturaRoubo: Boolean(input.coberturaRoubo),
      statusPagamento: String(input.statusPagamento ?? 'pendente'),
      notas: input.notas ? String(input.notas).trim() : null,
      apolicesJson: [],
    },
  });
  await syncSeguroVencimento(row, workspaceId, tenantId);
  return mapSeguro(row);
}

export async function updateAdminMgmtSeguro(
  id: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const existing = await prisma.adminMgmtSeguro.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return null;

  const tipoProduto =
    input.tipoProduto !== undefined ? String(input.tipoProduto).trim() : existing.tipoProduto;
  let matricula = existing.matricula;
  if (input.matricula !== undefined || input.tipoProduto !== undefined) {
    if (isAdminMgmtSeguroTipoAutomovel(tipoProduto)) {
      matricula = resolveMatricula(tipoProduto, input.matricula ?? existing.matricula ?? '');
    } else {
      matricula = null;
    }
  }

  const row = await prisma.adminMgmtSeguro.update({
    where: { id },
    data: {
      ...(input.seguradora !== undefined ? { seguradora: String(input.seguradora).trim() } : {}),
      ...(input.tipoProduto !== undefined ? { tipoProduto } : {}),
      ...(input.matricula !== undefined || input.tipoProduto !== undefined ? { matricula } : {}),
      ...(input.tipoProduto !== undefined
        ? { objetoTipo: isAdminMgmtSeguroTipoAutomovel(tipoProduto) ? 'viatura' : 'outro' }
        : {}),
      ...(input.opcaoCobertura !== undefined
        ? { opcaoCobertura: input.opcaoCobertura ? String(input.opcaoCobertura).trim() : null }
        : {}),
      ...(input.numeroApolice !== undefined
        ? { numeroApolice: input.numeroApolice ? String(input.numeroApolice).trim() : null }
        : {}),
      ...(input.dataFimPeriodo !== undefined
        ? { dataFimPeriodo: parseDate(String(input.dataFimPeriodo)) ?? existing.dataFimPeriodo }
        : {}),
      ...(input.dataInicioPeriodo !== undefined
        ? { dataInicioPeriodo: parseDate(String(input.dataInicioPeriodo)) }
        : {}),
      ...(input.totalPago !== undefined ? { totalPago: parseDecimal(input.totalPago) } : {}),
      ...(input.statusPagamento !== undefined
        ? { statusPagamento: String(input.statusPagamento) }
        : {}),
      ...(input.notas !== undefined ? { notas: input.notas ? String(input.notas).trim() : null } : {}),
    },
  });
  await syncSeguroVencimento(row, workspaceId, tenantId);
  return mapSeguro(row);
}

export async function deleteAdminMgmtSeguro(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtSeguro.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return false;

  for (const apolice of parseApolicesJson(existing.apolicesJson)) {
    await deleteAdminMgmtAttachmentFile(apolice.storageKey).catch(() => undefined);
  }
  if (existing.attachmentStorageKey) {
    await deleteAdminMgmtAttachmentFile(existing.attachmentStorageKey).catch(() => undefined);
  }

  await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'seguro', id);
  await prisma.adminMgmtSeguro.delete({ where: { id } });
  return true;
}

export async function uploadSeguroApolice(
  seguroId: string,
  workspaceId: string,
  tenantId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer }
) {
  const row = await prisma.adminMgmtSeguro.findFirst({
    where: { id: seguroId, workspaceId, tenantId },
  });
  if (!row) throw new Error('Seguro não encontrado');

  const apolices = parseApolicesJson(row.apolicesJson);
  if (apolices.length >= ADMIN_MGMT_MAX_APOlices) {
    throw new Error(`Máximo ${ADMIN_MGMT_MAX_APOlices} apólices por seguro`);
  }

  const mimeType = input.mimeType.toLowerCase();
  if (!ADMIN_MGMT_APOlice_MIME_TYPES.includes(mimeType as (typeof ADMIN_MGMT_APOlice_MIME_TYPES)[number])) {
    throw new Error('Formato não permitido — use PDF, PNG, JPEG ou WebP');
  }

  const apoliceId = randomUUID();
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = buildAdminMgmtStorageKey(
    tenantId,
    'seguros',
    seguroId,
    `apolices/${apoliceId}-${safeName}`
  );

  await assertTenantStorageQuota(prisma, tenantId, input.buffer.length);
  await saveAdminMgmtAttachmentFile(storageKey, input.buffer);

  const apolice: AdminMgmtApoliceFile = {
    id: apoliceId,
    fileName: input.fileName,
    storageKey,
    mimeType,
    sizeBytes: input.buffer.length,
    createdAt: new Date().toISOString(),
  };

  await prisma.adminMgmtSeguro.update({
    where: { id: seguroId },
    data: { apolicesJson: [...apolices, apolice] as unknown as Prisma.InputJsonValue },
  });

  return apolice;
}

export async function deleteSeguroApolice(
  seguroId: string,
  apoliceId: string,
  workspaceId: string,
  tenantId: string
) {
  const row = await prisma.adminMgmtSeguro.findFirst({
    where: { id: seguroId, workspaceId, tenantId },
  });
  if (!row) return false;

  const apolices = parseApolicesJson(row.apolicesJson);
  const target = apolices.find((a) => a.id === apoliceId);
  if (!target) return false;

  await deleteAdminMgmtAttachmentFile(target.storageKey).catch(() => undefined);
  await prisma.adminMgmtSeguro.update({
    where: { id: seguroId },
    data: {
      apolicesJson: apolices.filter((a) => a.id !== apoliceId) as unknown as Prisma.InputJsonValue,
    },
  });
  return true;
}

export async function getSeguroApoliceForDownload(
  seguroId: string,
  apoliceId: string,
  workspaceId: string,
  tenantId: string
) {
  const row = await prisma.adminMgmtSeguro.findFirst({
    where: { id: seguroId, workspaceId, tenantId },
  });
  if (!row) return null;
  const apolice = parseApolicesJson(row.apolicesJson).find((a) => a.id === apoliceId);
  return apolice ?? null;
}

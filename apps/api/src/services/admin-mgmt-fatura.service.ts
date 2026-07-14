import { randomUUID } from 'node:crypto';
import { prisma, Prisma } from '@tvde/database';
import {
  ADMIN_MGMT_FATURA_ANEXO_MIME_TYPES,
  ADMIN_MGMT_FATURA_METODOS_PAGAMENTO,
  ADMIN_MGMT_FATURA_TIPOS,
  ADMIN_MGMT_MAX_FATURA_ANEXOS,
  type AdminMgmtFaturaAnexo,
} from '@tvde/shared';
import {
  buildAdminMgmtStorageKey,
  deleteAdminMgmtAttachmentFile,
  saveAdminMgmtAttachmentFile,
} from './admin-mgmt-attachment-storage.service';
import {
  deleteAdminMgmtVencimentoByOrigem,
  resolveAdminMgmtVencimentoByOrigem,
  upsertAdminMgmtVencimento,
} from './admin-mgmt-vencimentos.service';
import { getAdminMgmtSettings, verifyAdminMgmtSecurityPin } from './admin-mgmt-settings.service';

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? new Prisma.Decimal(n) : null;
}

function mapDecimal(value: Prisma.Decimal | null | undefined): string | null {
  return value?.toString() ?? null;
}

function mapDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function parseAnexosJson(value: unknown): AdminMgmtFaturaAnexo[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as AdminMgmtFaturaAnexo)
    .filter((item) => typeof item.id === 'string' && typeof item.storageKey === 'string');
}

function mapFatura(
  row: Prisma.AdminMgmtFaturaGetPayload<{ include: { cliente: true } }>
) {
  const anexos = parseAnexosJson(row.anexosJson);
  return {
    id: row.id,
    clienteId: row.clienteId,
    clienteNome: row.cliente.nome,
    clienteNif: row.cliente.nif,
    tipoDocumento: row.tipoDocumento,
    numero: row.numero,
    atcud: row.atcud,
    dataEmissao: mapDate(row.dataEmissao)!,
    dataVencimento: mapDate(row.dataVencimento),
    descricaoResumo: row.descricaoResumo,
    valorLiquido: mapDecimal(row.valorLiquido),
    valorIva: mapDecimal(row.valorIva),
    valorTotal: mapDecimal(row.valorTotal)!,
    moeda: row.moeda,
    estadoPagamento: row.estadoPagamento,
    dataPagamento: mapDate(row.dataPagamento),
    metodoPagamento: row.metodoPagamento,
    anexos,
    anexoCount: anexos.length,
    notificarCliente: row.notificarCliente,
    notas: row.notas,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const faturaInclude = { cliente: true } as const;

async function syncFaturaVencimento(
  row: Prisma.AdminMgmtFaturaGetPayload<{ include: { cliente: true } }>,
  workspaceId: string,
  tenantId: string
) {
  if (
    !row.dataVencimento ||
    !row.notificarCliente ||
    row.estadoPagamento === 'pago' ||
    row.estadoPagamento === 'cancelado'
  ) {
    await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'fatura', row.id);
    return;
  }

  const resumo = row.descricaoResumo?.trim();
  await upsertAdminMgmtVencimento({
    tenantId,
    workspaceId,
    origemTipo: 'fatura',
    origemId: row.id,
    descricao: resumo ? `Fatura ${row.numero} — ${resumo}` : `Fatura ${row.numero} — ${row.cliente.nome}`,
    dataVencimento: row.dataVencimento,
    valorAssociado: Number(row.valorTotal),
  });
}

export async function listAdminMgmtFaturas(
  workspaceId: string,
  tenantId: string,
  filters?: { clienteId?: string; estadoPagamento?: string }
) {
  const rows = await prisma.adminMgmtFatura.findMany({
    where: {
      workspaceId,
      tenantId,
      ...(filters?.clienteId ? { clienteId: filters.clienteId } : {}),
      ...(filters?.estadoPagamento && filters.estadoPagamento !== 'all'
        ? { estadoPagamento: filters.estadoPagamento }
        : {}),
    },
    include: faturaInclude,
    orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(mapFatura);
}

export async function getAdminMgmtFatura(id: string, workspaceId: string, tenantId: string) {
  const row = await prisma.adminMgmtFatura.findFirst({
    where: { id, workspaceId, tenantId },
    include: faturaInclude,
  });
  return row ? mapFatura(row) : null;
}

export async function createAdminMgmtFatura(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const clienteId = String(input.clienteId ?? '').trim();
  if (!clienteId) throw new Error('Cliente é obrigatório');

  const cliente = await prisma.adminMgmtCliente.findFirst({
    where: { id: clienteId, workspaceId, tenantId },
  });
  if (!cliente) throw new Error('Cliente não encontrado');

  const dataEmissao = parseDate(String(input.dataEmissao ?? ''));
  if (!dataEmissao) throw new Error('Data de emissão é obrigatória');

  const valorTotal = parseDecimal(input.valorTotal);
  if (!valorTotal) throw new Error('Valor total é obrigatório');

  const numero = String(input.numero ?? '').trim();
  if (!numero) throw new Error('Número do documento é obrigatório');

  const tipoDocumento = String(input.tipoDocumento ?? 'fatura');
  if (!ADMIN_MGMT_FATURA_TIPOS.includes(tipoDocumento as (typeof ADMIN_MGMT_FATURA_TIPOS)[number])) {
    throw new Error('Tipo de documento inválido');
  }

  const row = await prisma.adminMgmtFatura.create({
    data: {
      tenantId,
      workspaceId,
      clienteId,
      tipoDocumento,
      numero,
      atcud: input.atcud ? String(input.atcud).trim() : null,
      dataEmissao,
      dataVencimento: parseDate(String(input.dataVencimento ?? '')),
      descricaoResumo: input.descricaoResumo ? String(input.descricaoResumo).trim() : null,
      valorLiquido: parseDecimal(input.valorLiquido),
      valorIva: parseDecimal(input.valorIva),
      valorTotal,
      moeda: String(input.moeda ?? 'EUR'),
      estadoPagamento: 'pendente',
      notificarCliente: Boolean(input.notificarCliente),
      notas: input.notas ? String(input.notas).trim() : null,
      anexosJson: [],
    },
    include: faturaInclude,
  });
  await syncFaturaVencimento(row, workspaceId, tenantId);
  return mapFatura(row);
}

export async function updateAdminMgmtFatura(
  id: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const existing = await prisma.adminMgmtFatura.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return null;

  const valorTotal =
    input.valorTotal !== undefined ? parseDecimal(input.valorTotal) : undefined;

  const row = await prisma.adminMgmtFatura.update({
    where: { id },
    data: {
      ...(input.tipoDocumento !== undefined ? { tipoDocumento: String(input.tipoDocumento) } : {}),
      ...(input.numero !== undefined ? { numero: String(input.numero).trim() } : {}),
      ...(input.atcud !== undefined ? { atcud: input.atcud ? String(input.atcud).trim() : null } : {}),
      ...(input.dataEmissao !== undefined
        ? { dataEmissao: parseDate(String(input.dataEmissao)) ?? existing.dataEmissao }
        : {}),
      ...(input.dataVencimento !== undefined
        ? { dataVencimento: parseDate(String(input.dataVencimento)) }
        : {}),
      ...(input.descricaoResumo !== undefined
        ? { descricaoResumo: input.descricaoResumo ? String(input.descricaoResumo).trim() : null }
        : {}),
      ...(input.valorLiquido !== undefined ? { valorLiquido: parseDecimal(input.valorLiquido) } : {}),
      ...(input.valorIva !== undefined ? { valorIva: parseDecimal(input.valorIva) } : {}),
      ...(valorTotal ? { valorTotal } : {}),
      ...(input.notificarCliente !== undefined
        ? { notificarCliente: Boolean(input.notificarCliente) }
        : {}),
      ...(input.notas !== undefined ? { notas: input.notas ? String(input.notas).trim() : null } : {}),
    },
    include: faturaInclude,
  });
  await syncFaturaVencimento(row, workspaceId, tenantId);
  return mapFatura(row);
}

export async function markAdminMgmtFaturaPaid(
  id: string,
  workspaceId: string,
  tenantId: string,
  input: { dataPagamento: string; metodoPagamento: string }
) {
  const existing = await prisma.adminMgmtFatura.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return null;

  const dataPagamento = parseDate(input.dataPagamento);
  if (!dataPagamento) throw new Error('Data de pagamento é obrigatória');

  const metodo = input.metodoPagamento.trim();
  if (!ADMIN_MGMT_FATURA_METODOS_PAGAMENTO.includes(metodo as (typeof ADMIN_MGMT_FATURA_METODOS_PAGAMENTO)[number])) {
    throw new Error('Método de pagamento inválido');
  }

  const row = await prisma.adminMgmtFatura.update({
    where: { id },
    data: {
      estadoPagamento: 'pago',
      dataPagamento,
      metodoPagamento: metodo,
    },
    include: faturaInclude,
  });
  await resolveAdminMgmtVencimentoByOrigem(workspaceId, tenantId, 'fatura', id);
  return mapFatura(row);
}

export async function markAdminMgmtFaturaPending(
  id: string,
  workspaceId: string,
  tenantId: string,
  options?: { pin?: string; internal?: boolean }
) {
  const existing = await prisma.adminMgmtFatura.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return null;

  if (!options?.internal) {
    const settings = await getAdminMgmtSettings(workspaceId, tenantId);
    if (!settings.securityPinConfigured) {
      throw new Error('Defina o PIN de Segurança em Configurações antes de reverter pagamentos');
    }
    const pin = options?.pin?.trim() ?? '';
    if (!pin) throw new Error('PIN de Segurança é obrigatório');
    const valid = await verifyAdminMgmtSecurityPin(workspaceId, tenantId, pin);
    if (!valid) throw new Error('PIN de Segurança incorrecto');
  }

  const row = await prisma.adminMgmtFatura.update({
    where: { id },
    data: {
      estadoPagamento: 'pendente',
      dataPagamento: null,
      metodoPagamento: null,
    },
    include: faturaInclude,
  });
  await syncFaturaVencimento(row, workspaceId, tenantId);
  return mapFatura(row);
}

export async function deleteAdminMgmtFatura(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtFatura.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return false;

  for (const anexo of parseAnexosJson(existing.anexosJson)) {
    await deleteAdminMgmtAttachmentFile(anexo.storageKey).catch(() => undefined);
  }
  await deleteAdminMgmtVencimentoByOrigem(workspaceId, 'fatura', id);
  await prisma.adminMgmtFatura.delete({ where: { id } });
  return true;
}

export async function uploadFaturaAnexo(
  faturaId: string,
  workspaceId: string,
  tenantId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer }
) {
  const row = await prisma.adminMgmtFatura.findFirst({
    where: { id: faturaId, workspaceId, tenantId },
  });
  if (!row) throw new Error('Fatura não encontrada');

  const anexos = parseAnexosJson(row.anexosJson);
  if (anexos.length >= ADMIN_MGMT_MAX_FATURA_ANEXOS) {
    throw new Error(`Máximo ${ADMIN_MGMT_MAX_FATURA_ANEXOS} anexos por fatura`);
  }

  const mimeType = input.mimeType.toLowerCase();
  if (!ADMIN_MGMT_FATURA_ANEXO_MIME_TYPES.includes(mimeType as (typeof ADMIN_MGMT_FATURA_ANEXO_MIME_TYPES)[number])) {
    throw new Error('Formato não permitido — use PDF');
  }

  const anexoId = randomUUID();
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = buildAdminMgmtStorageKey(
    tenantId,
    'faturas',
    faturaId,
    `anexos/${anexoId}-${safeName}`
  );

  await saveAdminMgmtAttachmentFile(storageKey, input.buffer);

  const anexo: AdminMgmtFaturaAnexo = {
    id: anexoId,
    fileName: input.fileName,
    storageKey,
    mimeType,
    sizeBytes: input.buffer.length,
    createdAt: new Date().toISOString(),
  };

  await prisma.adminMgmtFatura.update({
    where: { id: faturaId },
    data: { anexosJson: [...anexos, anexo] as unknown as Prisma.InputJsonValue },
  });

  return anexo;
}

export async function deleteFaturaAnexo(
  faturaId: string,
  anexoId: string,
  workspaceId: string,
  tenantId: string
) {
  const row = await prisma.adminMgmtFatura.findFirst({
    where: { id: faturaId, workspaceId, tenantId },
  });
  if (!row) return false;

  const anexos = parseAnexosJson(row.anexosJson);
  const target = anexos.find((a) => a.id === anexoId);
  if (!target) return false;

  await deleteAdminMgmtAttachmentFile(target.storageKey).catch(() => undefined);
  await prisma.adminMgmtFatura.update({
    where: { id: faturaId },
    data: {
      anexosJson: anexos.filter((a) => a.id !== anexoId) as unknown as Prisma.InputJsonValue,
    },
  });
  return true;
}

export async function getFaturaAnexoForDownload(
  faturaId: string,
  anexoId: string,
  workspaceId: string,
  tenantId: string
) {
  const row = await prisma.adminMgmtFatura.findFirst({
    where: { id: faturaId, workspaceId, tenantId },
  });
  if (!row) return null;
  const anexo = parseAnexosJson(row.anexosJson).find((a) => a.id === anexoId);
  return anexo ?? null;
}

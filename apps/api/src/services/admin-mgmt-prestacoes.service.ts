import { prisma, Prisma } from '@tvde/database';
import { ADMIN_MGMT_APOlice_MIME_TYPES, computeAdminMgmtPrestacaoSummary } from '@tvde/shared';
import {
  buildAdminMgmtStorageKey,
  deleteAdminMgmtAttachmentFile,
  saveAdminMgmtAttachmentFile,
} from './admin-mgmt-attachment-storage.service';

const COMPROVATIVO_MIMES = new Set<string>(ADMIN_MGMT_APOlice_MIME_TYPES);

export type PrestacaoPagamentoFileInput = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

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

function mapDecimal(value: Prisma.Decimal | null | undefined): string {
  return value?.toString() ?? '0';
}

function mapDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function mapPagamento(row: Prisma.AdminMgmtPrestacaoPagamentoGetPayload<object>) {
  return {
    id: row.id,
    prestacaoId: row.prestacaoId,
    valor: mapDecimal(row.valor),
    dataPagamento: mapDate(row.dataPagamento)!,
    mesReferencia: mapDate(row.mesReferencia),
    notas: row.notas,
    hasComprovativo: Boolean(row.comprovativoStorageKey),
    comprovativoFileName: row.comprovativoFileName,
    comprovativoMimeType: row.comprovativoMimeType,
    comprovativoSizeBytes: row.comprovativoSizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

async function persistComprovativo(
  tenantId: string,
  pagamentoId: string,
  file: PrestacaoPagamentoFileInput
) {
  if (!COMPROVATIVO_MIMES.has(file.mimeType)) {
    throw new Error('Tipo de ficheiro não permitido — use PDF ou imagem (PNG/JPEG/WebP)');
  }
  if (file.buffer.length <= 0) throw new Error('Ficheiro vazio');

  const storageKey = buildAdminMgmtStorageKey(
    tenantId,
    'prestacao-pagamento',
    pagamentoId,
    file.fileName
  );
  await saveAdminMgmtAttachmentFile(storageKey, file.buffer);
  return {
    comprovativoStorageKey: storageKey,
    comprovativoFileName: file.fileName,
    comprovativoMimeType: file.mimeType,
    comprovativoSizeBytes: file.buffer.length,
  };
}

function enrichPrestacao(
  row: Prisma.AdminMgmtPrestacaoGetPayload<{ include: { pagamentos: true } }>
) {
  const totalPago = row.pagamentos.reduce((sum, p) => sum + Number(p.valor), 0);
  const valorTotal = Number(row.valorTotal);
  const valorPrestacao = Number(row.valorPrestacao);
  const summary = computeAdminMgmtPrestacaoSummary(valorTotal, valorPrestacao, totalPago);

  return {
    id: row.id,
    titulo: row.titulo,
    beneficiarioNome: row.beneficiarioNome,
    beneficiarioNif: row.beneficiarioNif,
    valorTotal: mapDecimal(row.valorTotal),
    valorPrestacao: mapDecimal(row.valorPrestacao),
    diaVencimento: row.diaVencimento,
    dataInicio: mapDate(row.dataInicio)!,
    dataFimPrevista: mapDate(row.dataFimPrevista),
    status: row.status,
    notas: row.notas,
    totalPago: summary.totalPago.toFixed(2),
    saldoEmDivida: summary.saldo.toFixed(2),
    percentualPago: summary.percent,
    prestacoesPagas: row.pagamentos.length,
    prestacoesRestantes: summary.prestacoesRestantes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    pagamentos: row.pagamentos
      .sort((a, b) => b.dataPagamento.getTime() - a.dataPagamento.getTime())
      .map(mapPagamento),
  };
}

async function scopeWhere(id: string, workspaceId: string, tenantId: string) {
  return { id, workspaceId, tenantId };
}

async function refreshPrestacaoStatus(
  prestacaoId: string,
  workspaceId: string,
  tenantId: string
) {
  const row = await prisma.adminMgmtPrestacao.findFirst({
    where: await scopeWhere(prestacaoId, workspaceId, tenantId),
    include: { pagamentos: true },
  });
  if (!row || row.status === 'cancelado') return;

  const totalPago = row.pagamentos.reduce((sum, p) => sum + Number(p.valor), 0);
  const summary = computeAdminMgmtPrestacaoSummary(
    Number(row.valorTotal),
    Number(row.valorPrestacao),
    totalPago
  );

  const nextStatus = summary.concluido ? 'concluido' : row.status === 'concluido' ? 'ativo' : row.status;
  if (nextStatus !== row.status) {
    await prisma.adminMgmtPrestacao.update({
      where: { id: prestacaoId },
      data: { status: nextStatus },
    });
  }
}

export async function listAdminMgmtPrestacoes(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtPrestacao.findMany({
    where: { workspaceId, tenantId },
    include: { pagamentos: true },
    orderBy: [{ status: 'asc' }, { dataInicio: 'desc' }],
  });
  return rows.map(enrichPrestacao);
}

export async function getAdminMgmtPrestacao(id: string, workspaceId: string, tenantId: string) {
  const row = await prisma.adminMgmtPrestacao.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
    include: { pagamentos: true },
  });
  return row ? enrichPrestacao(row) : null;
}

export async function createAdminMgmtPrestacao(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const titulo = String(input.titulo ?? '').trim();
  const beneficiarioNome = String(input.beneficiarioNome ?? '').trim();
  const valorTotal = parseDecimal(input.valorTotal);
  const valorPrestacao = parseDecimal(input.valorPrestacao);
  const dataInicio = parseDate(String(input.dataInicio ?? ''));

  if (!titulo) throw new Error('Título é obrigatório');
  if (!beneficiarioNome) throw new Error('Beneficiário é obrigatório');
  if (!valorTotal || Number(valorTotal) <= 0) throw new Error('Valor total inválido');
  if (!valorPrestacao || Number(valorPrestacao) <= 0) throw new Error('Valor da prestação inválido');
  if (!dataInicio) throw new Error('Data início é obrigatória');

  const diaVencimento =
    input.diaVencimento !== null && input.diaVencimento !== undefined && input.diaVencimento !== ''
      ? Number(input.diaVencimento)
      : null;
  if (diaVencimento !== null && (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 28)) {
    throw new Error('Dia de vencimento deve ser entre 1 e 28');
  }

  const row = await prisma.adminMgmtPrestacao.create({
    data: {
      tenantId,
      workspaceId,
      titulo,
      beneficiarioNome,
      beneficiarioNif: input.beneficiarioNif ? String(input.beneficiarioNif).trim() : null,
      valorTotal,
      valorPrestacao,
      diaVencimento,
      dataInicio,
      dataFimPrevista: parseDate(String(input.dataFimPrevista ?? '')),
      status: String(input.status ?? 'ativo'),
      notas: input.notas ? String(input.notas).trim() : null,
    },
    include: { pagamentos: true },
  });

  return enrichPrestacao(row);
}

export async function updateAdminMgmtPrestacao(
  id: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const existing = await prisma.adminMgmtPrestacao.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
  });
  if (!existing) return null;

  const data: Prisma.AdminMgmtPrestacaoUpdateInput = {};

  if (input.titulo !== undefined) data.titulo = String(input.titulo).trim();
  if (input.beneficiarioNome !== undefined) data.beneficiarioNome = String(input.beneficiarioNome).trim();
  if (input.beneficiarioNif !== undefined) {
    data.beneficiarioNif = input.beneficiarioNif ? String(input.beneficiarioNif).trim() : null;
  }
  if (input.valorTotal !== undefined) {
    const v = parseDecimal(input.valorTotal);
    if (!v || Number(v) <= 0) throw new Error('Valor total inválido');
    data.valorTotal = v;
  }
  if (input.valorPrestacao !== undefined) {
    const v = parseDecimal(input.valorPrestacao);
    if (!v || Number(v) <= 0) throw new Error('Valor da prestação inválido');
    data.valorPrestacao = v;
  }
  if (input.diaVencimento !== undefined) {
    const d =
      input.diaVencimento === null || input.diaVencimento === ''
        ? null
        : Number(input.diaVencimento);
    if (d !== null && (!Number.isInteger(d) || d < 1 || d > 28)) {
      throw new Error('Dia de vencimento deve ser entre 1 e 28');
    }
    data.diaVencimento = d;
  }
  if (input.dataInicio !== undefined) {
    const d = parseDate(String(input.dataInicio ?? ''));
    if (!d) throw new Error('Data início inválida');
    data.dataInicio = d;
  }
  if (input.dataFimPrevista !== undefined) {
    data.dataFimPrevista = parseDate(String(input.dataFimPrevista ?? ''));
  }
  if (input.status !== undefined) data.status = String(input.status);
  if (input.notas !== undefined) data.notas = input.notas ? String(input.notas).trim() : null;

  const row = await prisma.adminMgmtPrestacao.update({
    where: { id },
    data,
    include: { pagamentos: true },
  });

  await refreshPrestacaoStatus(id, workspaceId, tenantId);
  const refreshed = await prisma.adminMgmtPrestacao.findFirst({
    where: { id },
    include: { pagamentos: true },
  });
  return refreshed ? enrichPrestacao(refreshed) : enrichPrestacao(row);
}

export async function deleteAdminMgmtPrestacao(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtPrestacao.findFirst({
    where: await scopeWhere(id, workspaceId, tenantId),
    include: { pagamentos: { select: { comprovativoStorageKey: true } } },
  });
  if (!existing) return false;

  for (const pagamento of existing.pagamentos) {
    if (pagamento.comprovativoStorageKey) {
      await deleteAdminMgmtAttachmentFile(pagamento.comprovativoStorageKey);
    }
  }

  await prisma.adminMgmtPrestacao.delete({ where: { id } });
  return true;
}

export async function createAdminMgmtPrestacaoPagamento(
  prestacaoId: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>,
  file?: PrestacaoPagamentoFileInput
) {
  const prestacao = await prisma.adminMgmtPrestacao.findFirst({
    where: await scopeWhere(prestacaoId, workspaceId, tenantId),
  });
  if (!prestacao) return null;
  if (prestacao.status === 'cancelado') throw new Error('Acordo cancelado');

  const valor = parseDecimal(input.valor ?? prestacao.valorPrestacao);
  const dataPagamento = parseDate(String(input.dataPagamento ?? ''));
  if (!valor || Number(valor) <= 0) throw new Error('Valor inválido');
  if (!dataPagamento) throw new Error('Data de pagamento é obrigatória');

  const pagamento = await prisma.adminMgmtPrestacaoPagamento.create({
    data: {
      tenantId,
      workspaceId,
      prestacaoId,
      valor,
      dataPagamento,
      mesReferencia: parseDate(String(input.mesReferencia ?? '')),
      notas: input.notas ? String(input.notas).trim() : null,
    },
  });

  if (file) {
    try {
      const comprovativo = await persistComprovativo(tenantId, pagamento.id, file);
      await prisma.adminMgmtPrestacaoPagamento.update({
        where: { id: pagamento.id },
        data: comprovativo,
      });
    } catch (err) {
      await prisma.adminMgmtPrestacaoPagamento.delete({ where: { id: pagamento.id } });
      throw err;
    }
  }

  await refreshPrestacaoStatus(prestacaoId, workspaceId, tenantId);
  return getAdminMgmtPrestacao(prestacaoId, workspaceId, tenantId);
}

export async function deleteAdminMgmtPrestacaoPagamento(
  prestacaoId: string,
  pagamentoId: string,
  workspaceId: string,
  tenantId: string
) {
  const pagamento = await prisma.adminMgmtPrestacaoPagamento.findFirst({
    where: { id: pagamentoId, prestacaoId, workspaceId, tenantId },
  });
  if (!pagamento) return false;

  if (pagamento.comprovativoStorageKey) {
    await deleteAdminMgmtAttachmentFile(pagamento.comprovativoStorageKey);
  }

  await prisma.adminMgmtPrestacaoPagamento.delete({ where: { id: pagamentoId } });
  await refreshPrestacaoStatus(prestacaoId, workspaceId, tenantId);
  return true;
}

export async function getAdminMgmtPrestacaoPagamentoComprovativo(
  prestacaoId: string,
  pagamentoId: string,
  workspaceId: string,
  tenantId: string
) {
  const pagamento = await prisma.adminMgmtPrestacaoPagamento.findFirst({
    where: { id: pagamentoId, prestacaoId, workspaceId, tenantId },
    select: {
      comprovativoStorageKey: true,
      comprovativoFileName: true,
      comprovativoMimeType: true,
    },
  });
  if (!pagamento?.comprovativoStorageKey) return null;
  return {
    storageKey: pagamento.comprovativoStorageKey,
    fileName: pagamento.comprovativoFileName ?? 'comprovativo',
    mimeType: pagamento.comprovativoMimeType ?? 'application/octet-stream',
  };
}

import { prisma, Prisma } from '@tvde/database';
import {
  markAdminMgmtFaturaPending,
} from './admin-mgmt-fatura.service';
import { resolveAdminMgmtVencimentoByOrigem } from './admin-mgmt-vencimentos.service';

function normalizeNif(nif: string | null | undefined): string | null {
  if (!nif?.trim()) return null;
  return nif.replace(/\s/g, '').toUpperCase();
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parsePositiveDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

type FaturaSaldoInput = { valorTotal: Prisma.Decimal | number; estadoPagamento: string };
type LancamentoSaldoInput = { valorAbatimento: Prisma.Decimal | number };

type FaturaParaLiquidacao = {
  id: string;
  numero: string;
  valorTotal: Prisma.Decimal;
  dataEmissao: Date;
  dataVencimento: Date | null;
  estadoPagamento: string;
};

function isFaturaEmAberto(estadoPagamento: string): boolean {
  return estadoPagamento === 'pendente' || estadoPagamento === 'parcial';
}

function sortFaturasParaLiquidacao(faturas: FaturaParaLiquidacao[], today: Date) {
  return faturas
    .filter((f) => isFaturaEmAberto(f.estadoPagamento))
    .sort((a, b) => {
      const aDue = a.dataVencimento ? startOfDay(a.dataVencimento).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dataVencimento ? startOfDay(b.dataVencimento).getTime() : Number.POSITIVE_INFINITY;
      const aOverdue = a.dataVencimento ? startOfDay(a.dataVencimento) < today : false;
      const bOverdue = b.dataVencimento ? startOfDay(b.dataVencimento) < today : false;

      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      if (aDue !== bDue) return aDue - bDue;
      return a.dataEmissao.getTime() - b.dataEmissao.getTime();
    });
}

async function computeLiquidacaoPreview(
  clienteId: string,
  workspaceId: string,
  tenantId: string,
  valor: number
) {
  const faturas = await prisma.adminMgmtFatura.findMany({
    where: { clienteId, workspaceId, tenantId },
    select: {
      id: true,
      numero: true,
      valorTotal: true,
      dataEmissao: true,
      dataVencimento: true,
      estadoPagamento: true,
    },
  });

  const today = startOfDay(new Date());
  const candidata = sortFaturasParaLiquidacao(faturas, today)[0];
  if (!candidata) {
    return { podeLiquidar: false as const };
  }

  const valorFatura = Number(candidata.valorTotal);
  if (valor < valorFatura) {
    return { podeLiquidar: false as const };
  }

  const emAtraso = candidata.dataVencimento
    ? startOfDay(candidata.dataVencimento) < today
    : false;

  return {
    podeLiquidar: true as const,
    fatura: {
      id: candidata.id,
      numero: candidata.numero,
      dataVencimento: candidata.dataVencimento?.toISOString().slice(0, 10) ?? null,
      valorTotal: valorFatura.toFixed(2),
      emAtraso,
    },
    valorFatura: valorFatura.toFixed(2),
    valorRemanescente: Math.max(0, valor - valorFatura).toFixed(2),
    valorTotal: valor.toFixed(2),
  };
}

function sumFaturasEmAberto(faturas: FaturaSaldoInput[]): number {
  return faturas
    .filter((f) => isFaturaEmAberto(f.estadoPagamento))
    .reduce((sum, f) => sum + Number(f.valorTotal), 0);
}

function sumLancamentos(lancamentos: LancamentoSaldoInput[]): number {
  return lancamentos.reduce((sum, l) => sum + Number(l.valorAbatimento), 0);
}

function calcSaldoLiquido(faturas: FaturaSaldoInput[], lancamentos: LancamentoSaldoInput[]): number {
  return Math.max(0, sumFaturasEmAberto(faturas) - sumLancamentos(lancamentos));
}

function mapLancamento(
  row: Prisma.AdminMgmtLancamentoGetPayload<{
    include: { faturaLiquidada: { select: { numero: true } } };
  }>
) {
  return {
    id: row.id,
    valor: row.valor.toString(),
    valorAbatimento: row.valorAbatimento.toString(),
    valorFaturaLiquidada: row.valorFaturaLiquidada?.toString() ?? null,
    faturaLiquidadaId: row.faturaLiquidadaId,
    faturaNumero: row.faturaLiquidada?.numero ?? null,
    descricao: row.descricao,
    dataLancamento: row.dataLancamento.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
  };
}

const lancamentoInclude = {
  faturaLiquidada: { select: { numero: true } },
} as const;

function mapCliente(
  row: Prisma.AdminMgmtClienteGetPayload<{
    include: {
      faturas: { select: { valorTotal: true; estadoPagamento: true } };
      lancamentos: { select: { valorAbatimento: true } };
    };
  }>
) {
  const totalFaturasEmAberto = sumFaturasEmAberto(row.faturas);
  const totalLancamentos = sumLancamentos(row.lancamentos);
  const saldoEmAberto = calcSaldoLiquido(row.faturas, row.lancamentos);

  return {
    id: row.id,
    nome: row.nome,
    nif: row.nif,
    email: row.email,
    telefone: row.telefone,
    morada: row.morada,
    cmsClientId: row.cmsClientId,
    billingEntityId: row.billingEntityId,
    faturaCount: row.faturas.length,
    totalFaturasEmAberto: totalFaturasEmAberto.toFixed(2),
    totalLancamentos: totalLancamentos.toFixed(2),
    saldoEmAberto: saldoEmAberto.toFixed(2),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapClienteSimple(row: Prisma.AdminMgmtClienteGetPayload<object>) {
  return {
    id: row.id,
    nome: row.nome,
    nif: row.nif,
    email: row.email,
    telefone: row.telefone,
    morada: row.morada,
    cmsClientId: row.cmsClientId,
    billingEntityId: row.billingEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAdminMgmtClientes(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtCliente.findMany({
    where: { workspaceId, tenantId },
    include: {
      faturas: { select: { valorTotal: true, estadoPagamento: true } },
      lancamentos: { select: { valorAbatimento: true } },
    },
    orderBy: [{ nome: 'asc' }],
  });
  return rows.map(mapCliente);
}

export async function getAdminMgmtCliente(id: string, workspaceId: string, tenantId: string) {
  const row = await prisma.adminMgmtCliente.findFirst({
    where: { id, workspaceId, tenantId },
    include: {
      faturas: {
        orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      },
      lancamentos: {
        orderBy: [{ dataLancamento: 'desc' }, { createdAt: 'desc' }],
        include: lancamentoInclude,
      },
    },
  });
  if (!row) return null;

  const year = new Date().getFullYear();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalFaturasEmAberto = sumFaturasEmAberto(row.faturas);
  const totalLancamentos = sumLancamentos(row.lancamentos);
  const saldoEmAberto = calcSaldoLiquido(row.faturas, row.lancamentos);

  const totalPagoAno = row.faturas
    .filter((f) => {
      if (f.estadoPagamento !== 'pago' || !f.dataPagamento) return false;
      return f.dataPagamento.getFullYear() === year;
    })
    .reduce((sum, f) => sum + Number(f.valorTotal), 0);

  const lancamentosAno = row.lancamentos
    .filter((l) => l.dataLancamento.getFullYear() === year)
    .reduce((sum, l) => sum + Number(l.valorAbatimento), 0);

  const faturasEmAtraso = row.faturas.filter((f) => {
    if (f.estadoPagamento !== 'pendente' && f.estadoPagamento !== 'parcial') return false;
    if (!f.dataVencimento) return false;
    const due = new Date(f.dataVencimento);
    due.setHours(0, 0, 0, 0);
    return due < today;
  }).length;

  return {
    id: row.id,
    nome: row.nome,
    nif: row.nif,
    email: row.email,
    telefone: row.telefone,
    morada: row.morada,
    cmsClientId: row.cmsClientId,
    billingEntityId: row.billingEntityId,
    faturaCount: row.faturas.length,
    totalFaturasEmAberto: totalFaturasEmAberto.toFixed(2),
    totalLancamentos: totalLancamentos.toFixed(2),
    saldoEmAberto: saldoEmAberto.toFixed(2),
    totalPagoAno: (totalPagoAno + lancamentosAno).toFixed(2),
    faturasEmAtraso,
    lancamentos: row.lancamentos.map(mapLancamento),
    faturas: row.faturas.map((f) => ({
      id: f.id,
      numero: f.numero,
      tipoDocumento: f.tipoDocumento,
      dataEmissao: f.dataEmissao.toISOString().slice(0, 10),
      dataVencimento: f.dataVencimento?.toISOString().slice(0, 10) ?? null,
      descricaoResumo: f.descricaoResumo,
      valorTotal: f.valorTotal.toString(),
      estadoPagamento: f.estadoPagamento,
      dataPagamento: f.dataPagamento?.toISOString().slice(0, 10) ?? null,
      metodoPagamento: f.metodoPagamento,
      notificarCliente: f.notificarCliente,
      emAtraso:
        (f.estadoPagamento === 'pendente' || f.estadoPagamento === 'parcial') &&
        f.dataVencimento
          ? (() => {
              const due = new Date(f.dataVencimento);
              due.setHours(0, 0, 0, 0);
              return due < today;
            })()
          : false,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function previewAdminMgmtClienteLancamento(
  clienteId: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const cliente = await prisma.adminMgmtCliente.findFirst({
    where: { id: clienteId, workspaceId, tenantId },
  });
  if (!cliente) return null;

  const valor = parsePositiveDecimal(input.valor);
  if (valor == null) throw new Error('Valor inválido — indique um montante positivo');

  return computeLiquidacaoPreview(clienteId, workspaceId, tenantId, valor);
}

export async function createAdminMgmtClienteLancamento(
  clienteId: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const cliente = await prisma.adminMgmtCliente.findFirst({
    where: { id: clienteId, workspaceId, tenantId },
  });
  if (!cliente) return null;

  const valor = parsePositiveDecimal(input.valor);
  if (valor == null) throw new Error('Valor inválido — indique um montante positivo');

  const dataLancamento = parseDate(input.dataLancamento ? String(input.dataLancamento) : null) ?? new Date();
  const descricao = input.descricao ? String(input.descricao).trim() : null;
  const liquidarFatura = Boolean(input.liquidarFatura);

  if (liquidarFatura) {
    const preview = await computeLiquidacaoPreview(clienteId, workspaceId, tenantId, valor);
    if (!preview.podeLiquidar || !preview.fatura) {
      throw new Error('Valor insuficiente para liquidar a fatura mais antiga');
    }

    const valorFatura = Number(preview.valorFatura);
    const valorAbatimento = Math.max(0, valor - valorFatura);

    await prisma.$transaction(async (tx) => {
      await tx.adminMgmtLancamento.create({
        data: {
          tenantId,
          workspaceId,
          clienteId,
          valor: new Prisma.Decimal(valor.toFixed(2)),
          valorAbatimento: new Prisma.Decimal(valorAbatimento.toFixed(2)),
          faturaLiquidadaId: preview.fatura.id,
          valorFaturaLiquidada: new Prisma.Decimal(valorFatura.toFixed(2)),
          descricao,
          dataLancamento,
        },
      });

      await tx.adminMgmtFatura.update({
        where: { id: preview.fatura.id },
        data: {
          estadoPagamento: 'pago',
          dataPagamento: dataLancamento,
          metodoPagamento: 'conta_corrente',
        },
      });
    });

    await resolveAdminMgmtVencimentoByOrigem(workspaceId, tenantId, 'fatura', preview.fatura.id);
  } else {
    await prisma.adminMgmtLancamento.create({
      data: {
        tenantId,
        workspaceId,
        clienteId,
        valor: new Prisma.Decimal(valor.toFixed(2)),
        valorAbatimento: new Prisma.Decimal(valor.toFixed(2)),
        descricao,
        dataLancamento,
      },
    });
  }

  return getAdminMgmtCliente(clienteId, workspaceId, tenantId);
}

export async function deleteAdminMgmtClienteLancamento(
  clienteId: string,
  lancamentoId: string,
  workspaceId: string,
  tenantId: string
) {
  const lancamento = await prisma.adminMgmtLancamento.findFirst({
    where: { id: lancamentoId, clienteId, workspaceId, tenantId },
  });
  if (!lancamento) return null;

  if (lancamento.faturaLiquidadaId) {
    await markAdminMgmtFaturaPending(lancamento.faturaLiquidadaId, workspaceId, tenantId, {
      internal: true,
    });
  }

  await prisma.adminMgmtLancamento.delete({ where: { id: lancamentoId } });
  return getAdminMgmtCliente(clienteId, workspaceId, tenantId);
}

export async function lookupAdminMgmtClientes(
  workspaceId: string,
  tenantId: string,
  query: string
) {
  const q = query.trim();
  if (q.length < 2) return { module: [], crm: [], billing: [] };

  const nif = normalizeNif(q);

  const [moduleRows, crmRows, billingRows] = await Promise.all([
    prisma.adminMgmtCliente.findMany({
      where: {
        workspaceId,
        tenantId,
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          ...(nif ? [{ nif: { contains: nif, mode: 'insensitive' as const } }] : []),
        ],
      },
      take: 10,
      orderBy: { nome: 'asc' },
    }),
    prisma.client.findMany({
      where: {
        workspaceId,
        tenantId,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          ...(nif ? [{ nif: { contains: nif, mode: 'insensitive' as const } }] : []),
        ],
      },
      take: 10,
      orderBy: { name: 'asc' },
    }),
    prisma.billingEntity.findMany({
      where: {
        workspaceId,
        tenantId,
        entityType: 'customer',
        status: 'active',
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          ...(nif ? [{ vat: { contains: nif, mode: 'insensitive' as const } }] : []),
        ],
      },
      take: 10,
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    module: moduleRows.map(mapClienteSimple),
    crm: crmRows.map((c) => ({
      source: 'crm' as const,
      id: c.id,
      nome: c.name,
      nif: c.nif,
      email: c.email,
      telefone: c.phone,
      morada: null as string | null,
    })),
    billing: billingRows.map((b) => ({
      source: 'billing' as const,
      id: b.id,
      nome: b.name,
      nif: b.vat,
      email: b.email,
      telefone: b.phone,
      morada: null as string | null,
      cmsClientId: b.cmsClientId,
    })),
  };
}

export async function createAdminMgmtCliente(
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const nome = String(input.nome ?? '').trim();
  if (!nome) throw new Error('Nome é obrigatório');

  const nif = input.nif ? normalizeNif(String(input.nif)) : null;

  if (nif) {
    const dup = await prisma.adminMgmtCliente.findFirst({
      where: { workspaceId, tenantId, nif },
    });
    if (dup) throw new Error(`Já existe cliente com NIF ${nif}`);
  }

  const row = await prisma.adminMgmtCliente.create({
    data: {
      tenantId,
      workspaceId,
      nome,
      nif,
      email: input.email ? String(input.email).trim() : null,
      telefone: input.telefone ? String(input.telefone).trim() : null,
      morada: input.morada ? String(input.morada).trim() : null,
      cmsClientId: input.cmsClientId ? String(input.cmsClientId) : null,
      billingEntityId: input.billingEntityId ? String(input.billingEntityId) : null,
    },
    include: {
      faturas: { select: { valorTotal: true, estadoPagamento: true } },
      lancamentos: { select: { valorAbatimento: true } },
    },
  });
  return mapCliente(row);
}

export async function updateAdminMgmtCliente(
  id: string,
  workspaceId: string,
  tenantId: string,
  input: Record<string, unknown>
) {
  const existing = await prisma.adminMgmtCliente.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return null;

  const row = await prisma.adminMgmtCliente.update({
    where: { id },
    data: {
      ...(input.nome !== undefined ? { nome: String(input.nome).trim() } : {}),
      ...(input.nif !== undefined ? { nif: input.nif ? normalizeNif(String(input.nif)) : null } : {}),
      ...(input.email !== undefined ? { email: input.email ? String(input.email).trim() : null } : {}),
      ...(input.telefone !== undefined
        ? { telefone: input.telefone ? String(input.telefone).trim() : null }
        : {}),
      ...(input.morada !== undefined ? { morada: input.morada ? String(input.morada).trim() : null } : {}),
    },
    include: {
      faturas: { select: { valorTotal: true, estadoPagamento: true } },
      lancamentos: { select: { valorAbatimento: true } },
    },
  });
  return mapCliente(row);
}

export async function deleteAdminMgmtCliente(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtCliente.findFirst({
    where: { id, workspaceId, tenantId },
    include: { faturas: { take: 1 } },
  });
  if (!existing) return false;
  if (existing.faturas.length > 0) {
    throw new Error('Cliente com faturas associadas — elimine as faturas primeiro');
  }
  await prisma.adminMgmtCliente.delete({ where: { id } });
  return true;
}

export async function importAdminMgmtClienteFromSource(
  workspaceId: string,
  tenantId: string,
  input: { source: 'crm' | 'billing'; sourceId: string }
) {
  if (input.source === 'crm') {
    const client = await prisma.client.findFirst({
      where: { id: input.sourceId, workspaceId, tenantId },
    });
    if (!client) throw new Error('Cliente CRM não encontrado');

    const linked = await prisma.adminMgmtCliente.findFirst({
      where: { workspaceId, tenantId, cmsClientId: client.id },
    });
    if (linked) return mapClienteSimple(linked);

    if (client.nif) {
      const byNif = await prisma.adminMgmtCliente.findFirst({
        where: { workspaceId, tenantId, nif: normalizeNif(client.nif) },
      });
      if (byNif) {
        return mapClienteSimple(
          await prisma.adminMgmtCliente.update({
            where: { id: byNif.id },
            data: { cmsClientId: client.id },
          })
        );
      }
    }

    const row = await prisma.adminMgmtCliente.create({
      data: {
        tenantId,
        workspaceId,
        nome: client.name,
        nif: client.nif,
        email: client.email,
        telefone: client.phone,
        cmsClientId: client.id,
      },
    });
    return mapClienteSimple(row);
  }

  const entity = await prisma.billingEntity.findFirst({
    where: { id: input.sourceId, workspaceId, tenantId, entityType: 'customer' },
  });
  if (!entity) throw new Error('Entidade fiscal não encontrada');

  const linked = await prisma.adminMgmtCliente.findFirst({
    where: { workspaceId, tenantId, billingEntityId: entity.id },
  });
  if (linked) return mapClienteSimple(linked);

  const nif = normalizeNif(entity.vat);
  if (nif) {
    const byNif = await prisma.adminMgmtCliente.findFirst({
      where: { workspaceId, tenantId, nif },
    });
    if (byNif) {
      return mapClienteSimple(
        await prisma.adminMgmtCliente.update({
          where: { id: byNif.id },
          data: { billingEntityId: entity.id, cmsClientId: entity.cmsClientId },
        })
      );
    }
  }

  const row = await prisma.adminMgmtCliente.create({
    data: {
      tenantId,
      workspaceId,
      nome: entity.name,
      nif: entity.vat,
      email: entity.email,
      telefone: entity.phone,
      cmsClientId: entity.cmsClientId,
      billingEntityId: entity.id,
    },
  });
  return mapClienteSimple(row);
}

/**
 * Resolve email/telefone do cliente admin-mgmt.
 * Fallback: ficha → entidade fiscal ligada → CRM ligado → match por NIF.
 * Se encontrar contacto noutra fonte e a ficha estiver vazia, preenche (backfill).
 */
export async function resolveAdminMgmtClienteContact(cliente: {
  id: string;
  workspaceId: string;
  tenantId: string;
  email: string | null;
  telefone: string | null;
  nif: string | null;
  cmsClientId: string | null;
  billingEntityId: string | null;
}): Promise<{ email: string; phone: string; source: 'ficha' | 'billing' | 'crm' }> {
  let email = cliente.email?.trim() || '';
  let phone = cliente.telefone?.trim() || '';
  if (email || phone) {
    return { email, phone, source: 'ficha' };
  }

  let source: 'billing' | 'crm' = 'billing';
  let billingEntityId: string | null = null;
  let cmsClientId: string | null = null;

  if (cliente.billingEntityId) {
    const be = await prisma.billingEntity.findFirst({
      where: {
        id: cliente.billingEntityId,
        workspaceId: cliente.workspaceId,
        tenantId: cliente.tenantId,
      },
      select: { id: true, email: true, phone: true },
    });
    if (be) {
      email = be.email?.trim() || '';
      phone = be.phone?.trim() || '';
      billingEntityId = be.id;
      source = 'billing';
    }
  }

  if (!email && !phone && cliente.cmsClientId) {
    const crm = await prisma.client.findFirst({
      where: {
        id: cliente.cmsClientId,
        workspaceId: cliente.workspaceId,
        tenantId: cliente.tenantId,
      },
      select: { id: true, email: true, phone: true },
    });
    if (crm) {
      email = crm.email?.trim() || '';
      phone = crm.phone?.trim() || '';
      cmsClientId = crm.id;
      source = 'crm';
    }
  }

  const nif = normalizeNif(cliente.nif);
  if (!email && !phone && nif) {
    const be = await prisma.billingEntity.findFirst({
      where: {
        workspaceId: cliente.workspaceId,
        tenantId: cliente.tenantId,
        entityType: 'customer',
        vat: nif,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, email: true, phone: true, cmsClientId: true },
    });
    if (be && (be.email?.trim() || be.phone?.trim())) {
      email = be.email?.trim() || '';
      phone = be.phone?.trim() || '';
      billingEntityId = be.id;
      cmsClientId = be.cmsClientId ?? null;
      source = 'billing';
    } else {
      const crm = await prisma.client.findFirst({
        where: {
          workspaceId: cliente.workspaceId,
          tenantId: cliente.tenantId,
          nif,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, phone: true },
      });
      if (crm && (crm.email?.trim() || crm.phone?.trim())) {
        email = crm.email?.trim() || '';
        phone = crm.phone?.trim() || '';
        cmsClientId = crm.id;
        source = 'crm';
      }
    }
  }

  if (email || phone) {
    await prisma.adminMgmtCliente.update({
      where: { id: cliente.id },
      data: {
        ...(!cliente.email && email ? { email } : {}),
        ...(!cliente.telefone && phone ? { telefone: phone } : {}),
        ...(!cliente.billingEntityId && billingEntityId ? { billingEntityId } : {}),
        ...(!cliente.cmsClientId && cmsClientId ? { cmsClientId } : {}),
      },
    });
    return { email, phone, source };
  }

  return { email: '', phone: '', source: 'ficha' };
}

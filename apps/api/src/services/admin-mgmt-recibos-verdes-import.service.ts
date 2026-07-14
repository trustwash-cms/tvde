import { prisma, Prisma } from '@tvde/database';
import {
  parseRecibosVerdesCsv,
  type RecibosVerdesCsvParsedRow,
  type RecibosVerdesImportPreviewRow,
  type RecibosVerdesImportResult,
} from '@tvde/shared';

function normalizeNif(nif: string | null | undefined): string | null {
  if (!nif?.trim()) return null;
  return nif.replace(/\s/g, '').toUpperCase();
}

function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: ${value}`);
  return d;
}

async function findExistingFatura(
  workspaceId: string,
  tenantId: string,
  row: RecibosVerdesCsvParsedRow
) {
  if (row.origemExternaId) {
    const byOrigem = await prisma.adminMgmtFatura.findFirst({
      where: { workspaceId, tenantId, origemExternaId: row.origemExternaId },
    });
    if (byOrigem) return byOrigem;
  }

  const clientes = row.nifAdquirente
    ? await prisma.adminMgmtCliente.findMany({
        where: { workspaceId, tenantId, nif: row.nifAdquirente },
        select: { id: true },
      })
    : [];

  if (clientes.length === 0) return null;

  return prisma.adminMgmtFatura.findFirst({
    where: {
      workspaceId,
      tenantId,
      numero: row.referencia,
      dataEmissao: parseDate(row.dataEmissao),
      clienteId: { in: clientes.map((c) => c.id) },
    },
  });
}

async function findOrCreateCliente(
  workspaceId: string,
  tenantId: string,
  row: RecibosVerdesCsvParsedRow
): Promise<{ cliente: { id: string }; created: boolean; updated: boolean }> {
  const nif = row.nifAdquirente ? normalizeNif(row.nifAdquirente) : null;

  if (nif) {
    const existing = await prisma.adminMgmtCliente.findFirst({
      where: { workspaceId, tenantId, nif },
    });
    if (existing) {
      let updated = false;
      if (!existing.nome?.trim() && row.nomeAdquirente) {
        await prisma.adminMgmtCliente.update({
          where: { id: existing.id },
          data: { nome: row.nomeAdquirente },
        });
        updated = true;
      }
      return { cliente: existing, created: false, updated };
    }
  }

  const created = await prisma.adminMgmtCliente.create({
    data: {
      tenantId,
      workspaceId,
      nome: row.nomeAdquirente,
      nif,
    },
  });
  return { cliente: created, created: true, updated: false };
}

export async function previewRecibosVerdesCsvImport(
  workspaceId: string,
  tenantId: string,
  csvText: string
): Promise<{ rows: RecibosVerdesImportPreviewRow[]; errors: RecibosVerdesImportResult['erros'] }> {
  const parsed = parseRecibosVerdesCsv(csvText);
  const previewRows: RecibosVerdesImportPreviewRow[] = [];

  for (const row of parsed.rows) {
    const existing = await findExistingFatura(workspaceId, tenantId, row);
    let clienteExistente = false;
    if (row.nifAdquirente) {
      const nif = normalizeNif(row.nifAdquirente);
      clienteExistente = Boolean(
        nif &&
          (await prisma.adminMgmtCliente.findFirst({
            where: { workspaceId, tenantId, nif },
          }))
      );
    }

    previewRows.push({
      ...row,
      status: existing ? 'duplicado' : 'novo',
      clienteExistente,
      message: existing ? 'Documento já importado' : undefined,
    });
  }

  return { rows: previewRows, errors: [...parsed.errors] };
}

export async function confirmRecibosVerdesCsvImport(
  workspaceId: string,
  tenantId: string,
  csvText: string,
  ficheiroNome?: string | null
): Promise<RecibosVerdesImportResult> {
  const parsed = parseRecibosVerdesCsv(csvText);
  const result: RecibosVerdesImportResult = {
    clientesCriados: 0,
    clientesActualizados: 0,
    faturasCriadas: 0,
    faturasIgnoradas: 0,
    erros: [...parsed.errors],
  };

  for (const row of parsed.rows) {
    try {
      const existing = await findExistingFatura(workspaceId, tenantId, row);
      if (existing) {
        result.faturasIgnoradas++;
        continue;
      }

      const { cliente, created, updated } = await findOrCreateCliente(workspaceId, tenantId, row);
      if (created) result.clientesCriados++;
      if (updated) result.clientesActualizados++;

      const dataEmissao = parseDate(row.dataEmissao);
      const estadoPagamento = row.estadoPagamento;
      const dataPagamento = estadoPagamento === 'pago' ? dataEmissao : null;

      await prisma.adminMgmtFatura.create({
        data: {
          tenantId,
          workspaceId,
          clienteId: cliente.id,
          tipoDocumento: row.tipoDocumentoCms,
          numero: row.referencia,
          atcud: row.atcud,
          dataEmissao,
          descricaoResumo: row.motivoEmissao,
          valorLiquido: new Prisma.Decimal(row.valorLiquido),
          valorIva: new Prisma.Decimal(row.valorIva),
          valorTotal: new Prisma.Decimal(row.valorTotal),
          estadoPagamento,
          dataPagamento,
          metodoPagamento: estadoPagamento === 'pago' ? 'conta_corrente' : null,
          origem: 'portal_financas',
          origemExternaId: row.origemExternaId,
          anexosJson: [],
        },
      });
      result.faturasCriadas++;
    } catch (err) {
      result.erros.push({
        line: row.line,
        referencia: row.referencia,
        message: err instanceof Error ? err.message : 'Erro ao importar linha',
      });
    }
  }

  await prisma.adminMgmtImportacao.create({
    data: {
      tenantId,
      workspaceId,
      tipo: 'csv_sire',
      ficheiroNome: ficheiroNome ?? null,
      resumoJson: {
        clientesCriados: result.clientesCriados,
        clientesActualizados: result.clientesActualizados,
        faturasCriadas: result.faturasCriadas,
        faturasIgnoradas: result.faturasIgnoradas,
        erros: result.erros.length,
      },
      errosJson: result.erros as unknown as Prisma.InputJsonValue,
    },
  });

  return result;
}

export async function listRecibosVerdesImportacoes(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtImportacao.findMany({
    where: { workspaceId, tenantId, tipo: 'csv_sire' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return rows.map((row) => ({
    id: row.id,
    tipo: row.tipo,
    ficheiroNome: row.ficheiroNome,
    resumo: row.resumoJson,
    erros: row.errosJson,
    createdAt: row.createdAt.toISOString(),
  }));
}

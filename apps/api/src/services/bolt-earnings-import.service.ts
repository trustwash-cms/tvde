import type { PrismaClient } from '@tvde/database';
import { Prisma } from '@prisma/client';

const PT_MONTHS: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  marco: 3,
  março: 3,
  abr: 4,
  abril: 4,
  mai: 5,
  maio: 5,
  jun: 6,
  junho: 6,
  jul: 7,
  julho: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  setembro: 9,
  out: 10,
  outubro: 10,
  nov: 11,
  novembro: 11,
  dez: 12,
  dezembro: 12,
};

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/^\xEF\xBB\xBF/, '');
}

function normalizeHeader(h: string): string {
  return h
    .replace(/"/g, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\|€/g, '')
    .replace(/€/g, '')
    .replace(/\s+/g, ' ');
}

/** Parse CSV line respecting quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseMoney(raw: string): number | null {
  const s = raw.replace(/"/g, '').replace(/€/gi, '').replace(/\s/g, '').trim();
  if (!s) return null;
  const normalized =
    s.includes(',') && s.includes('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.includes(',')
        ? s.replace(',', '.')
        : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parsePtDate(day: string, monthRaw: string, year: string): Date | null {
  const m = PT_MONTHS[monthRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
  const d = Number(day);
  const y = Number(year);
  if (!m || !d || !y) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Extrai datas do nome Fleet, ex.:
 * `Ganhos por motorista-24 ago 2026-30 ago 2026-Caminhos….csv`
 */
export function parseBoltEarningsPeriodFromFilename(
  filename: string
): { periodStart: Date; periodEnd: Date } | null {
  const re = /(\d{1,2})\s+([A-Za-zçãéúô.]+)\s+(\d{4})/g;
  const matches: Date[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(filename)) !== null) {
    const dt = parsePtDate(m[1]!, m[2]!.replace(/\./g, ''), m[3]!);
    if (dt) matches.push(dt);
    if (matches.length >= 2) break;
  }
  if (matches.length < 2) return null;
  const [a, b] = matches;
  if (a.getTime() <= b.getTime()) return { periodStart: a, periodEnd: b };
  return { periodStart: b, periodEnd: a };
}

export type BoltEarningsImportRow = {
  driverUuid: string;
  driverName: string | null;
  netAmount: number;
  grossTotal: number | null;
  tips: number | null;
  cancellationFees: number | null;
};

export function parseBoltEarningsCsv(csvText: string): {
  rows: BoltEarningsImportRow[];
  errors: string[];
} {
  const text = stripBom(csvText);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV vazio ou sem dados'] };
  }

  const headers = splitCsvLine(lines[0]!).map(normalizeHeader);
  const idx = (aliases: string[]) => {
    for (const a of aliases) {
      const i = headers.findIndex((h) => h === a || h.includes(a));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iUuid = idx(['identificador do motorista', 'driver uuid', 'uuid motorista']);
  const iName = idx(['motorista', 'nome']);
  const iNet = idx(['pagamento previsto', 'ganhos liquidos', 'pago a si']);
  const iGross = idx(['ganhos brutos (total)', 'ganhos brutos total']);
  const iTips = idx(['gorjetas dos passageiros', 'gorjetas']);
  const iCancel = idx(['taxas de cancelamento']);

  const errors: string[] = [];
  if (iUuid < 0) errors.push('Coluna «Identificador do motorista» em falta');
  if (iNet < 0) errors.push('Coluna «Pagamento previsto» / «Ganhos líquidos» em falta');
  if (errors.length) return { rows: [], errors };

  const rows: BoltEarningsImportRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]!);
    const driverUuid = (cols[iUuid] ?? '').replace(/"/g, '').trim();
    if (!driverUuid) continue;
    const netAmount = parseMoney(cols[iNet] ?? '');
    if (netAmount == null) {
      errors.push(`Linha ${li + 1}: valor líquido inválido`);
      continue;
    }
    rows.push({
      driverUuid,
      driverName: iName >= 0 ? (cols[iName] ?? '').replace(/"/g, '').trim() || null : null,
      netAmount,
      grossTotal: iGross >= 0 ? parseMoney(cols[iGross] ?? '') : null,
      tips: iTips >= 0 ? parseMoney(cols[iTips] ?? '') : null,
      cancellationFees: iCancel >= 0 ? parseMoney(cols[iCancel] ?? '') : null,
    });
  }

  return { rows, errors };
}

export async function importBoltEarningsCsvText(
  db: PrismaClient,
  tenantId: string,
  importedByUserId: string,
  csvText: string,
  opts: { filename?: string; periodStart?: string; periodEnd?: string }
) {
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  if (opts.periodStart && opts.periodEnd) {
    periodStart = new Date(`${opts.periodStart}T00:00:00.000Z`);
    periodEnd = new Date(`${opts.periodEnd}T00:00:00.000Z`);
  } else if (opts.filename) {
    const fromName = parseBoltEarningsPeriodFromFilename(opts.filename);
    if (fromName) {
      periodStart = fromName.periodStart;
      periodEnd = fromName.periodEnd;
    }
  }

  if (!periodStart || !periodEnd || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error(
      'Não foi possível obter o período. Use um CSV Fleet com datas no nome ' +
        '(ex. «24 ago 2026-30 ago 2026») ou indique periodStart/periodEnd.'
    );
  }

  const { rows, errors } = parseBoltEarningsCsv(csvText);
  if (!rows.length && errors.length) {
    throw new Error(errors.join('; '));
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const existing = await db.boltDriverEarning.findUnique({
        where: {
          tenantId_driverUuid_periodStart_periodEnd: {
            tenantId,
            driverUuid: row.driverUuid,
            periodStart,
            periodEnd,
          },
        },
      });
      if (existing?.isPaid) {
        skipped += 1;
        continue;
      }
      await db.boltDriverEarning.upsert({
        where: {
          tenantId_driverUuid_periodStart_periodEnd: {
            tenantId,
            driverUuid: row.driverUuid,
            periodStart,
            periodEnd,
          },
        },
        create: {
          tenantId,
          driverUuid: row.driverUuid,
          driverName: row.driverName,
          periodStart,
          periodEnd,
          netAmount: new Prisma.Decimal(row.netAmount.toFixed(2)),
          grossTotal: row.grossTotal != null ? new Prisma.Decimal(row.grossTotal.toFixed(2)) : null,
          tips: row.tips != null ? new Prisma.Decimal(row.tips.toFixed(2)) : null,
          cancellationFees:
            row.cancellationFees != null
              ? new Prisma.Decimal(row.cancellationFees.toFixed(2))
              : null,
          sourceFilename: opts.filename ?? null,
          importedByUserId,
        },
        update: {
          driverName: row.driverName,
          netAmount: new Prisma.Decimal(row.netAmount.toFixed(2)),
          grossTotal: row.grossTotal != null ? new Prisma.Decimal(row.grossTotal.toFixed(2)) : null,
          tips: row.tips != null ? new Prisma.Decimal(row.tips.toFixed(2)) : null,
          cancellationFees:
            row.cancellationFees != null
              ? new Prisma.Decimal(row.cancellationFees.toFixed(2))
              : null,
          sourceFilename: opts.filename ?? null,
          importedByUserId,
        },
      });
      if (existing) updated += 1;
      else inserted += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    total: rows.length,
    inserted,
    updated,
    skipped,
    failed: errors.length,
    errors,
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  };
}

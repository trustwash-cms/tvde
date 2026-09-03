import type { PrismaClient } from '@tvde/database';
import {
  parseCombustivelRows,
  parseElectricityRows,
  parseUberCsv,
  normalizeSpreadsheetRows,
  type PortalKind,
} from '@tvde/shared';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';
import { mkdir, readdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { importViaVerdeCsv } from '../via-verde-import.service';
import { importElectricityCsv } from '../electricity-import.service';

const PRIO_EXPORT_TMP = join(process.cwd(), '.tmp-prio-exports');

function bufferToRows(buffer: Buffer, filename: string): string[][] {
  void filename;
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return normalizeSpreadsheetRows(
    XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]
  );
}

function contentKind(rows: string[][]): 'electric' | 'fuel' | 'unknown' {
  const flat = rows
    .slice(0, 10)
    .flat()
    .map((c) => String(c).toLowerCase())
    .join(' | ');
  if (/energia|carregamento|total c\/?\s*iva|id carregamento/.test(flat)) return 'electric';
  if (/posto|litros|combustivel|recibo/.test(flat) && /total/.test(flat)) return 'fuel';
  return 'unknown';
}

function summarizeRowsPreview(rows: string[][]): string {
  const header = rows.find((r) => r.some((c) => /data|cart|total|posto|energia/i.test(String(c))));
  if (!header) return `linhas=${rows.length}`;
  return `linhas=${rows.length} header=[${header
    .filter(Boolean)
    .slice(0, 8)
    .join(' | ')}]`;
}

async function clearPrioExportTmp() {
  try {
    const names = await readdir(PRIO_EXPORT_TMP);
    await Promise.all(names.map((n) => unlink(join(PRIO_EXPORT_TMP, n)).catch(() => undefined)));
  } catch {
    /* dir may not exist */
  }
}

async function importFuelFromRows(
  db: PrismaClient,
  tenantId: string,
  importedByUserId: string,
  rows: string[][]
) {
  const { rows: parsed, errors } = parseCombustivelRows(rows);
  let inserted = 0;
  let skipped = 0;

  for (const row of parsed) {
    const existing = row.receiptNumber
      ? await db.fuelTransaction.findFirst({
          where: { tenantId, receiptNumber: row.receiptNumber },
          select: { id: true },
        })
      : await db.fuelTransaction.findFirst({
          where: {
            tenantId,
            chargeDate: row.chargeDate,
            cardNumber: row.cardNumber,
            totalWithVat: row.totalWithVat,
          },
          select: { id: true },
        });

    if (existing) {
      skipped += 1;
      continue;
    }

    await db.fuelTransaction.create({
      data: {
        tenantId,
        station: row.station,
        chargeDate: row.chargeDate,
        cardNumber: row.cardNumber,
        cardDescription: row.cardDescription,
        liters: row.liters,
        fuelType: row.fuelType,
        receiptNumber: row.receiptNumber,
        totalWithVat: row.totalWithVat,
        clientName: row.clientName,
        importedByUserId,
      },
    });
    inserted += 1;
  }

  return {
    inserted,
    skipped,
    failed: errors.length,
    message: `Combustível: ${inserted} inseridos, ${skipped} ignorados`,
  };
}

async function importUberFromCsv(
  db: PrismaClient,
  tenantId: string,
  importedByUserId: string,
  csvText: string,
  filename?: string
) {
  const { rows, errors, kind } = parseUberCsv(csvText, { filename });
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await db.uberPayment.create({
        data: {
          tenantId,
          driverUuid: row.driverUuid,
          firstName: row.firstName,
          lastName: row.lastName,
          reportDate: row.reportDate,
          amount: row.amount,
          transactionUuid: row.transactionUuid,
          description: row.description,
          importedByUserId,
        },
      });
      inserted += 1;
    } catch {
      skipped += 1;
    }
  }

  const kindLabel =
    kind === 'payments_driver' ? 'rendimentos líquidos (Pagamentos do motorista)' : 'transações';
  return {
    inserted,
    skipped,
    failed: errors.length,
    message: `Uber (${kindLabel}): ${inserted} inseridos, ${skipped} ignorados`,
  };
}

export async function ingestPortalDownloadedFiles(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  importedByUserId: string,
  files: Array<{ filename: string; buffer: Buffer }>
) {
  const summaries: Array<{ inserted: number; skipped: number; failed: number; message?: string }> = [];
  const seenHashes = new Set<string>();

  if (portal === 'recibos_verdes') {
    return {
      inserted: 0,
      skipped: 0,
      failed: 0,
      message: 'Sessão AT válida. Use import CSV para os recibos.',
    };
  }

  for (const file of files) {
    if (portal === 'via_verde') {
      summaries.push(
        await importViaVerdeCsv(db, tenantId, importedByUserId, file.buffer, file.filename)
      );
      continue;
    }

    if (portal === 'uber') {
      summaries.push(
        await importUberFromCsv(
          db,
          tenantId,
          importedByUserId,
          file.buffer.toString('utf-8'),
          file.filename
        )
      );
      continue;
    }

    const hash = createHash('sha256').update(file.buffer).digest('hex');
    if (seenHashes.has(hash)) {
      summaries.push({
        inserted: 0,
        skipped: 0,
        failed: 0,
        message: `${file.filename}: duplicado do export anterior (ignorado)`,
      });
      continue;
    }
    seenHashes.add(hash);

    const rows = bufferToRows(file.buffer, file.filename);
    const preview = summarizeRowsPreview(rows);
    const kind = contentKind(rows);
    const nameWantsElectric = /eletr|electr/i.test(file.filename);
    const nameWantsFuel = /frota|fuel|combust/i.test(file.filename);

    let summary: { inserted: number; skipped: number; failed: number; message?: string };

    if (kind === 'electric') {
      summary = await importElectricityCsv(db, tenantId, importedByUserId, file.buffer, file.filename);
    } else if (kind === 'fuel') {
      if (nameWantsElectric) {
        summary = {
          inserted: 0,
          skipped: 0,
          failed: 1,
          message:
            `${file.filename}: conteúdo é Frota (não Electric). ` +
            `Abra Transações → Prio Electric no portal ou use import manual. · ${preview}`,
        };
      } else {
        summary = await importFuelFromRows(db, tenantId, importedByUserId, rows);
      }
    } else {
      const { rows: fuelRows, errors: fuelErrors } = parseCombustivelRows(rows);
      const { rows: elecRows, errors: elecErrors } = parseElectricityRows(rows);

      if (nameWantsElectric && elecRows.length > 0) {
        summary = await importElectricityCsv(db, tenantId, importedByUserId, file.buffer, file.filename);
      } else if ((nameWantsFuel || !nameWantsElectric) && fuelRows.length > 0) {
        summary = await importFuelFromRows(db, tenantId, importedByUserId, rows);
      } else if (elecRows.length > 0) {
        summary = await importElectricityCsv(db, tenantId, importedByUserId, file.buffer, file.filename);
      } else if (fuelRows.length > 0) {
        summary = await importFuelFromRows(db, tenantId, importedByUserId, rows);
      } else {
        const errHint = [
          ...elecErrors.slice(0, 3).map((e) => `elec:${e.message}`),
          ...fuelErrors.slice(0, 3).map((e) => `fuel:${e.message}`),
        ].join('; ');
        summary = {
          inserted: 0,
          skipped: 0,
          failed: Math.max(elecErrors.length, fuelErrors.length, 1),
          message:
            `${file.filename} (${file.buffer.length} bytes): 0 linhas · ${preview}` +
            (errHint ? ` · ${errHint}` : ' · ficheiro sem dados ou filtro de datas vazio'),
        };

        try {
          await mkdir(PRIO_EXPORT_TMP, { recursive: true });
          const safe = file.filename.replace(/[^\w.\-]+/g, '_').slice(0, 80);
          await writeFile(join(PRIO_EXPORT_TMP, `${Date.now()}-${safe}`), file.buffer);
        } catch {
          /* ignore */
        }
      }
    }

    summaries.push(summary);
  }

  const inserted = summaries.reduce((s, x) => s + x.inserted, 0);
  const skipped = summaries.reduce((s, x) => s + x.skipped, 0);
  const failed = summaries.reduce((s, x) => s + x.failed, 0);

  // Sucesso: não manter XLS no disco (só falhas de parse ficam em .tmp-prio-exports)
  if (inserted + skipped > 0 && failed === 0) {
    await clearPrioExportTmp();
  }

  return {
    inserted,
    skipped,
    failed,
    message: summaries.map((s) => s.message).filter(Boolean).join(' · ') || undefined,
  };
}

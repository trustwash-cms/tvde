import type { PrismaClient } from '@tvde/database';
import { parseViaVerdeRows, type ViaVerdeImportResult } from '@tvde/shared';
import { parseImportFileToRows, validateImportFilename } from '../lib/spreadsheet-import';
import {
  loadTenantVehiclesForMatching,
  matchViaVerdeToVehicle,
} from './user-vehicle-matching.service';

export async function importViaVerdeCsv(
  db: PrismaClient,
  tenantId: string,
  importedByUserId: string,
  fileBuffer: Buffer,
  filename: string
): Promise<ViaVerdeImportResult> {
  validateImportFilename(filename, ['.csv', '.txt', '.xls', '.xlsx']);
  const rawRows = parseImportFileToRows(fileBuffer, filename);
  const { rows, errors } = parseViaVerdeRows(rawRows);
  const vehicles = await loadTenantVehiclesForMatching(db, tenantId);

  let inserted = 0;
  let skipped = 0;
  const importErrors = [...errors];

  for (const row of rows) {
    const existingByObu = await db.viaVerdeMovement.findUnique({
      where: { tenantId_obu: { tenantId, obu: row.obu } },
      select: { id: true, systemEntryDate: true },
    });

    // Deduplicar também por matrícula+data+valor (o Identificador do site VV não é único por movimento)
    const existingByTrip =
      !existingByObu && row.entryDate
        ? await db.viaVerdeMovement.findFirst({
            where: {
              tenantId,
              licensePlate: row.licensePlate,
              entryDate: row.entryDate,
              value: row.value,
            },
            select: { id: true, systemEntryDate: true },
          })
        : null;

    const existing = existingByObu ?? existingByTrip;
    if (existing) {
      // Backfill Data cobrança em linhas já importadas sem systemEntryDate
      if (!existing.systemEntryDate && (row.systemEntryDate || row.entryDate)) {
        await db.viaVerdeMovement.update({
          where: { id: existing.id },
          data: { systemEntryDate: row.systemEntryDate ?? row.entryDate },
        });
      }
      skipped += 1;
      continue;
    }

    const referenceDate = row.systemEntryDate ?? row.entryDate;
    const match = matchViaVerdeToVehicle(vehicles, row.licensePlate, referenceDate);

    try {
      await db.viaVerdeMovement.create({
        data: {
          tenantId,
          userId: match.userId,
          userVehicleId: match.userVehicleId,
          licensePlate: row.licensePlate,
          iai: row.iai,
          obu: row.obu,
          serviceCode: row.serviceCode,
          serviceDescription: row.serviceDescription,
          marketCode: row.marketCode,
          marketDescription: row.marketDescription,
          entryDate: row.entryDate,
          exitDate: row.exitDate,
          entryPoint: row.entryPoint,
          exitPoint: row.exitPoint,
          value: row.value,
          isPaid: row.isPaid,
          paymentDate: row.paymentDate,
          contractNumber: row.contractNumber,
          liquidValue: row.liquidValue,
          discountBalance: row.discountBalance,
          mobilityAccount: row.mobilityAccount,
          paymentMethod: row.paymentMethod,
          systemEntryDate: row.systemEntryDate,
          importedByUserId,
        },
      });
      inserted += 1;
    } catch (err) {
      importErrors.push({
        line: row.line,
        obu: row.obu,
        message: err instanceof Error ? err.message : 'Erro ao inserir',
      });
    }
  }

  return {
    total: rows.length,
    inserted,
    skipped,
    failed: importErrors.length - errors.length,
    errors: importErrors,
  };
}

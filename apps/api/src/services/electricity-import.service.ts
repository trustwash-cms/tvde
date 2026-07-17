import type { PrismaClient } from '@tvde/database';
import { parseElectricityRows, type ElectricityImportResult } from '@tvde/shared';
import { parseImportFileToRows, validateImportFilename } from '../lib/spreadsheet-import';
import {
  loadTenantVehiclesForMatching,
  matchElectricityToVehicle,
} from './user-vehicle-matching.service';

async function findExistingCharge(
  db: PrismaClient,
  tenantId: string,
  row: {
    chargeExternalId: string | null;
    chargeDate: Date;
    cardNumber: string | null;
    station: string | null;
    totalWithVat: number;
  }
) {
  if (row.chargeExternalId) {
    return db.electricityCharge.findFirst({
      where: { tenantId, chargeExternalId: row.chargeExternalId },
      select: { id: true },
    });
  }

  return db.electricityCharge.findFirst({
    where: {
      tenantId,
      chargeDate: row.chargeDate,
      cardNumber: row.cardNumber,
      station: row.station,
      totalWithVat: row.totalWithVat,
    },
    select: { id: true },
  });
}

export async function importElectricityCsv(
  db: PrismaClient,
  tenantId: string,
  importedByUserId: string,
  fileBuffer: Buffer,
  filename: string
): Promise<ElectricityImportResult> {
  validateImportFilename(filename, ['.csv', '.txt', '.xls', '.xlsx']);
  const rawRows = parseImportFileToRows(fileBuffer, filename);
  const { rows, errors } = parseElectricityRows(rawRows);
  const vehicles = await loadTenantVehiclesForMatching(db, tenantId);

  let inserted = 0;
  let skipped = 0;
  const importErrors = [...errors];

  for (const row of rows) {
    const existing = await findExistingCharge(db, tenantId, row);
    if (existing) {
      skipped += 1;
      continue;
    }

    // Matching por cartão PRIO / nome — matrícula não é usada na Electric
    const match = matchElectricityToVehicle(vehicles, {
      cardNumber: row.cardNumber,
      name: row.name,
      licensePlate: null,
      chargeDate: row.chargeDate,
    });

    try {
      await db.electricityCharge.create({
        data: {
          tenantId,
          userId: match.userId,
          userVehicleId: match.userVehicleId,
          chargeExternalId: row.chargeExternalId,
          chargeDate: row.chargeDate,
          cardNumber: row.cardNumber,
          name: row.name,
          licensePlate: null,
          station: row.station,
          energyKwh: row.energyKwh,
          duration: row.duration,
          totalWithVat: row.totalWithVat,
          importedByUserId,
        },
      });
      inserted += 1;
    } catch (err) {
      importErrors.push({
        line: row.line,
        chargeExternalId: row.chargeExternalId ?? undefined,
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

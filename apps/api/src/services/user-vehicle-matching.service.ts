import type { PrismaClient } from '@tvde/database';
import { hasMinRole, type Role } from '@tvde/shared';
import { normalizeUserVehicleMatricula, stripLicenseInput } from '@tvde/shared';
import {
  pickBestUserVehicleForPeriod,
  type UserVehiclePeriodRecord,
} from '@tvde/shared';

function normalizePlateForMatch(licensePlate: string): string {
  try {
    return normalizeUserVehicleMatricula({ matricula: licensePlate }).matricula;
  } catch {
    try {
      return normalizeUserVehicleMatricula({
        matricula: licensePlate,
        matriculaForeign: true,
      }).matricula;
    } catch {
      return stripLicenseInput(licensePlate) || licensePlate.trim().toUpperCase();
    }
  }
}

export interface TenantVehicleMatchRecord extends UserVehiclePeriodRecord {
  userId: string;
  numCartaoPrio: string | null;
  nomeCompleto: string | null;
}

export interface DriverFleetScope {
  plates: string[];
  cardNumbers: string[];
  uuidUber: string[];
  uuidBolt: string[];
}

/** Alias do plano motorista — mesmo helper. */
export type DriverScope = DriverFleetScope;

export interface VehicleMatchResult {
  userId: string | null;
  userVehicleId: string | null;
}

export async function loadTenantVehiclesForMatching(
  db: PrismaClient,
  tenantId: string
): Promise<TenantVehicleMatchRecord[]> {
  const rows = await db.userVehicle.findMany({
    where: { tenantId },
    select: {
      id: true,
      userId: true,
      matricula: true,
      dataInicio: true,
      dataFim: true,
      numCartaoPrio: true,
      nomeCompleto: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    matricula: row.matricula,
    dataInicio: row.dataInicio,
    dataFim: row.dataFim,
    numCartaoPrio: row.numCartaoPrio,
    nomeCompleto: row.nomeCompleto,
  }));
}

export async function getDriverFleetScope(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role
): Promise<DriverFleetScope | null> {
  if (hasMinRole(actorRole, 'superadmin')) return null;

  const vehicles = await db.userVehicle.findMany({
    where: { tenantId, userId: actorId },
    select: { matricula: true, numCartaoPrio: true, uuidUber: true, uuidBolt: true },
  });

  return {
    plates: vehicles.map((vehicle) => vehicle.matricula),
    cardNumbers: vehicles
      .map((vehicle) => vehicle.numCartaoPrio?.trim())
      .filter((value): value is string => Boolean(value)),
    uuidUber: vehicles
      .map((vehicle) => vehicle.uuidUber?.trim())
      .filter((value): value is string => Boolean(value)),
    uuidBolt: vehicles
      .map((vehicle) => vehicle.uuidBolt?.trim())
      .filter((value): value is string => Boolean(value)),
  };
}

export const getDriverScope = getDriverFleetScope;

export function matchViaVerdeToVehicle(
  vehicles: TenantVehicleMatchRecord[],
  licensePlate: string,
  referenceDate: Date | null
): VehicleMatchResult {
  const plate = normalizePlateForMatch(licensePlate);
  const ref = referenceDate ?? new Date();
  const vehicle = pickBestUserVehicleForPeriod(vehicles, plate, ref, ref);

  return vehicle
    ? { userId: vehicle.userId, userVehicleId: vehicle.id }
    : { userId: null, userVehicleId: null };
}

export function matchElectricityToVehicle(
  vehicles: TenantVehicleMatchRecord[],
  input: {
    cardNumber: string | null;
    name: string | null;
    licensePlate: string | null;
    chargeDate: Date;
  }
): VehicleMatchResult {
  if (input.cardNumber?.trim()) {
    const card = input.cardNumber.trim();
    const byCard = vehicles.find((vehicle) => vehicle.numCartaoPrio?.trim() === card);
    if (byCard) {
      return { userId: byCard.userId, userVehicleId: byCard.id };
    }
  }

  if (input.name?.trim()) {
    const name = input.name.trim().toLowerCase();
    const byName = vehicles.find(
      (vehicle) => vehicle.nomeCompleto?.trim().toLowerCase() === name
    );
    if (byName) {
      return { userId: byName.userId, userVehicleId: byName.id };
    }
  }

  if (input.licensePlate?.trim()) {
    return matchViaVerdeToVehicle(vehicles, input.licensePlate, input.chargeDate);
  }

  return { userId: null, userVehicleId: null };
}

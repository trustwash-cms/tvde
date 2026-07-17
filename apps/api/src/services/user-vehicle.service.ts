import type {
  Prisma,
  PrismaClient,
  VehicleCommissionType,
} from '@tvde/database';
import {
  VEHICLE_COMMISSION_TYPES,
  canViewUserProfile,
  formatDateOnlyInput,
  isUserVehicleActive,
  normalizeUserVehicleMatricula,
  parseDateOnlyInput,
  parseOptionalDecimal,
  parseOptionalYear,
  type Role,
  type UserVehicleRecord,
} from '@tvde/shared';
import { createAuditLog } from './audit.service';
import {
  assertTenantCanAddActiveVehicle,
  TenantVehicleLimitError,
} from './tenant-vehicle-limits.service';

export class UserVehicleAccessError extends Error {
  constructor(message = 'Sem permissão') {
    super(message);
    this.name = 'UserVehicleAccessError';
  }
}

export class UserVehicleNotFoundError extends Error {
  constructor(message = 'Viatura não encontrada') {
    super(message);
    this.name = 'UserVehicleNotFoundError';
  }
}

function trimOrNull(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapVehicle(vehicle: {
  id: string;
  userId: string;
  tenantId: string;
  matricula: string;
  matriculaForeign: boolean;
  matriculaCountry: string;
  dataInicio: Date;
  dataFim: Date | null;
  uuidUber: string | null;
  uuidBolt: string | null;
  numCartaoPrio: string | null;
  nomeCompleto: string | null;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  aluguelViatura: Prisma.Decimal | null;
  comissaoTipo: VehicleCommissionType | null;
  comissaoValor: Prisma.Decimal | null;
  comissaoIva6: boolean;
  slotIncluirViaVerde: boolean;
  slotIncluirEletricidadeCombustivel: boolean;
  createdAt: Date;
  updatedAt: Date;
}): UserVehicleRecord {
  return {
    id: vehicle.id,
    userId: vehicle.userId,
    tenantId: vehicle.tenantId,
    matricula: vehicle.matricula,
    matriculaForeign: vehicle.matriculaForeign,
    matriculaCountry: vehicle.matriculaCountry,
    dataInicio: formatDateOnlyInput(vehicle.dataInicio),
    dataFim: vehicle.dataFim ? formatDateOnlyInput(vehicle.dataFim) : null,
    uuidUber: vehicle.uuidUber,
    uuidBolt: vehicle.uuidBolt,
    numCartaoPrio: vehicle.numCartaoPrio,
    nomeCompleto: vehicle.nomeCompleto,
    marca: vehicle.marca,
    modelo: vehicle.modelo,
    ano: vehicle.ano,
    aluguelViatura: vehicle.aluguelViatura?.toString() ?? null,
    comissaoTipo: vehicle.comissaoTipo,
    comissaoValor: vehicle.comissaoValor?.toString() ?? null,
    comissaoIva6: vehicle.comissaoIva6,
    slotIncluirViaVerde: vehicle.slotIncluirViaVerde,
    slotIncluirEletricidadeCombustivel: vehicle.slotIncluirEletricidadeCombustivel,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

async function getTargetUser(db: PrismaClient, userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, tenantId: true, fullName: true, username: true },
  });
}

function assertTenantScope(
  actorRole: Role,
  actorTenantId: string | null,
  targetTenantId: string | null
): void {
  if (actorRole === 'master') return;
  if (!targetTenantId || targetTenantId !== actorTenantId) {
    throw new UserVehicleNotFoundError('Utilizador não encontrado');
  }
}

function assertCanManageVehicles(
  actorId: string,
  actorRole: Role,
  targetUserId: string,
  targetRole: Role
): void {
  if (!canViewUserProfile(actorId, actorRole, targetUserId, targetRole)) {
    throw new UserVehicleAccessError();
  }
}

export interface UserVehicleInput {
  matricula: string;
  matriculaForeign?: boolean;
  matriculaCountry?: string | null;
  dataInicio: string;
  dataFim?: string | null;
  uuidUber?: string | null;
  uuidBolt?: string | null;
  numCartaoPrio?: string | null;
  nomeCompleto?: string | null;
  marca?: string | null;
  modelo?: string | null;
  ano?: string | number | null;
  aluguelViatura?: string | number | null;
  comissaoTipo?: VehicleCommissionType | null;
  comissaoValor?: string | number | null;
  comissaoIva6?: boolean;
  slotIncluirViaVerde?: boolean;
  slotIncluirEletricidadeCombustivel?: boolean;
}

function normalizeVehicleInput(input: UserVehicleInput) {
  const plate = normalizeUserVehicleMatricula({
    matricula: input.matricula,
    matriculaForeign: input.matriculaForeign,
    matriculaCountry: input.matriculaCountry,
  });

  const dataInicio = parseDateOnlyInput(input.dataInicio);
  const dataFim = input.dataFim?.trim() ? parseDateOnlyInput(input.dataFim) : null;

  if (dataFim && dataFim.getTime() < dataInicio.getTime()) {
    throw new Error('A data de fim não pode ser anterior à data de início');
  }

  const comissaoTipo = input.comissaoTipo ?? null;
  if (comissaoTipo && !VEHICLE_COMMISSION_TYPES.includes(comissaoTipo)) {
    throw new Error('Tipo de comissão inválido');
  }

  const comissaoValor = comissaoTipo ? parseOptionalDecimal(input.comissaoValor) : null;
  if (comissaoTipo && !comissaoValor) {
    throw new Error('Indique o valor da comissão');
  }

  const aluguelViatura = parseOptionalDecimal(input.aluguelViatura);

  return {
    ...plate,
    dataInicio,
    dataFim,
    uuidUber: trimOrNull(input.uuidUber ?? null),
    uuidBolt: trimOrNull(input.uuidBolt ?? null),
    numCartaoPrio: trimOrNull(input.numCartaoPrio ?? null),
    nomeCompleto: trimOrNull(input.nomeCompleto ?? null),
    marca: trimOrNull(input.marca ?? null),
    modelo: trimOrNull(input.modelo ?? null),
    ano: parseOptionalYear(input.ano),
    aluguelViatura,
    comissaoTipo,
    comissaoValor,
    comissaoIva6: Boolean(input.comissaoIva6),
    slotIncluirViaVerde: Boolean(input.slotIncluirViaVerde),
    slotIncluirEletricidadeCombustivel: Boolean(input.slotIncluirEletricidadeCombustivel),
  };
}

export async function listUserVehicles(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string
): Promise<UserVehicleRecord[]> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master') {
    throw new UserVehicleNotFoundError('Utilizador não encontrado');
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);
  assertCanManageVehicles(actorId, actorRole, user.id, user.role);

  const vehicles = await db.userVehicle.findMany({
    where: { userId: targetUserId },
    orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
  });

  return vehicles.map(mapVehicle);
}

export async function createUserVehicle(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string,
  input: UserVehicleInput,
  ipAddress?: string
): Promise<UserVehicleRecord> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master' || !user.tenantId) {
    throw new UserVehicleNotFoundError('Utilizador não encontrado');
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);
  assertCanManageVehicles(actorId, actorRole, user.id, user.role);

  const data = normalizeVehicleInput(input);
  const willBeActive = isUserVehicleActive(data.dataFim);
  await assertTenantCanAddActiveVehicle(db, user.tenantId, willBeActive);

  const vehicle = await db.userVehicle.create({
    data: {
      userId: targetUserId,
      tenantId: user.tenantId,
      ...data,
    },
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId: actorId,
    action: 'user.vehicle.create',
    entityType: 'user_vehicle',
    entityId: vehicle.id,
    afterJson: { userId: targetUserId, matricula: vehicle.matricula },
    ipAddress,
  });

  return mapVehicle(vehicle);
}

export async function updateUserVehicle(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string,
  vehicleId: string,
  input: UserVehicleInput,
  ipAddress?: string
): Promise<UserVehicleRecord> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master' || !user.tenantId) {
    throw new UserVehicleNotFoundError('Utilizador não encontrado');
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);
  assertCanManageVehicles(actorId, actorRole, user.id, user.role);

  const existing = await db.userVehicle.findFirst({
    where: { id: vehicleId, userId: targetUserId },
  });
  if (!existing) {
    throw new UserVehicleNotFoundError();
  }

  const data = normalizeVehicleInput(input);
  const willBeActive = isUserVehicleActive(data.dataFim);
  await assertTenantCanAddActiveVehicle(db, user.tenantId, willBeActive, vehicleId);

  const vehicle = await db.userVehicle.update({
    where: { id: vehicleId },
    data,
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId: actorId,
    action: 'user.vehicle.update',
    entityType: 'user_vehicle',
    entityId: vehicle.id,
    beforeJson: { matricula: existing.matricula },
    afterJson: { matricula: vehicle.matricula },
    ipAddress,
  });

  return mapVehicle(vehicle);
}

export async function deleteUserVehicle(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string,
  vehicleId: string,
  ipAddress?: string
): Promise<void> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master' || !user.tenantId) {
    throw new UserVehicleNotFoundError('Utilizador não encontrado');
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);
  assertCanManageVehicles(actorId, actorRole, user.id, user.role);

  const existing = await db.userVehicle.findFirst({
    where: { id: vehicleId, userId: targetUserId },
  });
  if (!existing) {
    throw new UserVehicleNotFoundError();
  }

  await db.userVehicle.delete({ where: { id: vehicleId } });

  await createAuditLog({
    tenantId: user.tenantId,
    userId: actorId,
    action: 'user.vehicle.delete',
    entityType: 'user_vehicle',
    entityId: vehicleId,
    beforeJson: { userId: targetUserId, matricula: existing.matricula },
    ipAddress,
  });
}

export function handleUserVehicleError(err: unknown): {
  status: number;
  message: string;
  limits?: unknown;
} {
  if (err instanceof UserVehicleAccessError) {
    return { status: 403, message: err.message };
  }
  if (err instanceof UserVehicleNotFoundError) {
    return { status: 404, message: err.message };
  }
  if (err instanceof TenantVehicleLimitError) {
    return { status: 409, message: err.message, limits: err.limits };
  }
  if (err instanceof Error) {
    return { status: 400, message: err.message };
  }
  return { status: 500, message: 'Erro interno' };
}

import { prisma } from '@tvde/database';
import { Prisma } from '@prisma/client';
import {
  computeSyncWindow,
  type BoltOrderStop,
  type BoltSyncCounters,
  type BoltSyncType,
} from '@tvde/bolt';
import { getMonthUtcRange } from '@tvde/shared';
import { textOr } from './search.service';
import { ensureBoltClient, getBoltConnection } from './bolt-connection.service';

/** Corridas concluídas com valor — usado em listagens e dashboard. */
export function boltBillableOrderWhere(
  workspaceId: string,
  extra?: Prisma.BoltOrderWhereInput
): Prisma.BoltOrderWhereInput {
  return {
    workspaceId,
    orderStatus: 'finished',
    ridePrice: { not: null, gt: 0 },
    ...extra,
  };
}

function toDecimal(value: unknown): Prisma.Decimal | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return new Prisma.Decimal(n);
}

function tsToDate(value: unknown): Date | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

async function writeSyncLog(input: {
  workspaceId: string;
  tenantId: string;
  syncType: string;
  status: 'success' | 'error';
  startedAt: Date;
  counters?: BoltSyncCounters;
  errorMessage?: string;
}) {
  const completedAt = new Date();
  await prisma.boltSyncLog.create({
    data: {
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      syncType: input.syncType,
      status: input.status,
      recordsSynced: input.counters?.synced ?? 0,
      recordsCreated: input.counters?.created ?? 0,
      recordsUpdated: input.counters?.updated ?? 0,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt,
      completedAt,
      durationSeconds: Math.max(0, Math.round((completedAt.getTime() - input.startedAt.getTime()) / 1000)),
    },
  });
}

export async function syncBoltOrders(workspaceId: string): Promise<BoltSyncCounters> {
  const { row, client } = await ensureBoltClient(workspaceId);
  const companyId = row.boltCompanyId!;
  const { startTs, endTs } = computeSyncWindow(row.lastSyncAtOrders);
  const orders = await client.getFleetOrders({ companyId, startTs, endTs });

  let created = 0;
  let updated = 0;

  for (const order of orders) {
    if (!order.order_reference) continue;
    const ridePrice = order.order_price?.ride_price ?? order.ride_price;
    const data = {
      boltCompanyId: companyId,
      driverName: order.driver_name ?? null,
      driverUuid: order.driver_uuid ?? null,
      driverPhone: order.driver_phone ?? null,
      orderStatus: order.order_status ?? null,
      vehicleModel: order.vehicle_model ?? null,
      vehicleLicensePlate: order.vehicle_license_plate ?? null,
      orderCreatedTimestamp: tsToDate(order.order_created_timestamp),
      ridePrice: toDecimal(ridePrice),
      bookingFee: toDecimal(order.order_price?.booking_fee),
      tollFee: toDecimal(order.order_price?.toll_fee),
      rawJson: order as unknown as Prisma.InputJsonValue,
      syncedAt: new Date(),
    };

    const existing = await prisma.boltOrder.findUnique({
      where: {
        workspaceId_orderReference: {
          workspaceId,
          orderReference: order.order_reference,
        },
      },
      select: { id: true },
    });

    const saved = existing
      ? await prisma.boltOrder.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.boltOrder.create({
          data: {
            workspaceId,
            tenantId: row.tenantId,
            orderReference: order.order_reference,
            ...data,
          },
        });

    if (existing) updated += 1;
    else created += 1;

    await prisma.boltOrderStop.deleteMany({ where: { orderId: saved.id } });
    const stops = order.order_stops ?? [];
    if (stops.length) {
      await prisma.boltOrderStop.createMany({
        data: stops.map((stop: BoltOrderStop, index: number) => ({
          orderId: saved.id,
          stopType: stop.stop_type ?? stop.type ?? 'pickup',
          lat: toDecimal(stop.lat),
          lng: toDecimal(stop.lng),
          realLat: toDecimal(stop.real_lat),
          realLng: toDecimal(stop.real_lng),
          stopOrder: stop.stop_order ?? index,
        })),
      });
    }
  }

  await prisma.boltConnection.update({
    where: { workspaceId },
    data: { lastSyncAtOrders: new Date(), lastError: null },
  });

  return { synced: orders.length, created, updated, skipped: 0 };
}

export async function syncBoltDrivers(workspaceId: string): Promise<BoltSyncCounters> {
  const { row, client } = await ensureBoltClient(workspaceId);
  const companyId = row.boltCompanyId!;
  const { startTs, endTs } = computeSyncWindow(row.lastSyncAtDrivers);
  const drivers = await client.getDrivers({ companyId, startTs, endTs });

  let created = 0;
  let updated = 0;

  for (const driver of drivers) {
    if (!driver.driver_uuid) continue;
    const data = {
      boltCompanyId: companyId,
      partnerUuid: driver.partner_uuid ?? null,
      name:
        driver.name ??
        ([driver.first_name, driver.last_name].filter((part) => part && String(part).trim()).join(' ') || null),
      phone: driver.phone ?? null,
      email: driver.email ?? null,
      portalStatus: driver.portal_status ?? driver.state ?? null,
      createdAtTimestamp: tsToDate(driver.created_at_timestamp),
      syncedAt: new Date(),
    };

    const existing = await prisma.boltDriver.findUnique({
      where: {
        workspaceId_driverUuid: { workspaceId, driverUuid: driver.driver_uuid },
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.boltDriver.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.boltDriver.create({
        data: {
          workspaceId,
          tenantId: row.tenantId,
          driverUuid: driver.driver_uuid,
          ...data,
        },
      });
      created += 1;
    }
  }

  await prisma.boltConnection.update({
    where: { workspaceId },
    data: { lastSyncAtDrivers: new Date(), lastError: null },
  });

  return { synced: drivers.length, created, updated, skipped: 0 };
}

export async function syncBoltVehicles(workspaceId: string): Promise<BoltSyncCounters> {
  const { row, client } = await ensureBoltClient(workspaceId);
  const companyId = row.boltCompanyId!;
  const { startTs, endTs } = computeSyncWindow(row.lastSyncAtVehicles);
  const vehicles = await client.getVehicles({ companyId, startTs, endTs });

  let created = 0;
  let updated = 0;

  for (const vehicle of vehicles) {
    const vehicleId = String(vehicle.id ?? vehicle.vehicle_id ?? vehicle.uuid ?? '');
    if (!vehicleId) continue;

    const data = {
      boltCompanyId: companyId,
      model: vehicle.model ?? null,
      year: vehicle.year ?? null,
      regNumber: vehicle.reg_number ?? null,
      vin: vehicle.vin ?? null,
      uuid: vehicle.uuid ?? null,
      state: vehicle.state ?? null,
      portalStatus: vehicle.portal_status ?? vehicle.state ?? null,
      syncedAt: new Date(),
    };

    const existing = await prisma.boltVehicle.findUnique({
      where: { workspaceId_vehicleId: { workspaceId, vehicleId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.boltVehicle.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.boltVehicle.create({
        data: {
          workspaceId,
          tenantId: row.tenantId,
          vehicleId,
          ...data,
        },
      });
      created += 1;
    }
  }

  await prisma.boltConnection.update({
    where: { workspaceId },
    data: { lastSyncAtVehicles: new Date(), lastError: null },
  });

  return { synced: vehicles.length, created, updated, skipped: 0 };
}

export async function syncBoltData(
  workspaceId: string,
  type: BoltSyncType
): Promise<Record<string, BoltSyncCounters>> {
  const startedAt = new Date();
  const row = await getBoltConnection(workspaceId);
  if (!row) throw new Error('Bolt não configurado');

  const results: Record<string, BoltSyncCounters> = {};

  try {
    if (type === 'orders' || type === 'all') {
      results.orders = await syncBoltOrders(workspaceId);
    }
    if (type === 'drivers' || type === 'all') {
      results.drivers = await syncBoltDrivers(workspaceId);
    }
    if (type === 'vehicles' || type === 'all') {
      results.vehicles = await syncBoltVehicles(workspaceId);
    }

    const totals = Object.values(results).reduce(
      (acc, item) => ({
        synced: acc.synced + item.synced,
        created: acc.created + item.created,
        updated: acc.updated + item.updated,
        skipped: acc.skipped + item.skipped,
      }),
      { synced: 0, created: 0, updated: 0, skipped: 0 }
    );

    await writeSyncLog({
      workspaceId,
      tenantId: row.tenantId,
      syncType: type,
      status: 'success',
      startedAt,
      counters: totals,
    });

    return results;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha na sincronização Bolt';
    await prisma.boltConnection.update({
      where: { workspaceId },
      data: { lastError: message },
    }).catch(() => undefined);
    await writeSyncLog({
      workspaceId,
      tenantId: row.tenantId,
      syncType: type,
      status: 'error',
      startedAt,
      errorMessage: message,
    });
    throw err;
  }
}

export async function syncAllBoltWorkspaces(type: BoltSyncType = 'all') {
  const connections = await prisma.boltConnection.findMany({
    where: { isActive: true, boltCompanyId: { not: null } },
    select: { workspaceId: true },
  });

  const summary: Array<{ workspaceId: string; ok: boolean; error?: string }> = [];

  for (const conn of connections) {
    const enabled = await prisma.workspaceModule.findFirst({
      where: { workspaceId: conn.workspaceId, moduleKey: 'bolt', enabled: true },
    });
    if (!enabled) continue;

    try {
      await syncBoltData(conn.workspaceId, type);
      summary.push({ workspaceId: conn.workspaceId, ok: true });
    } catch (err) {
      summary.push({
        workspaceId: conn.workspaceId,
        ok: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  }

  return summary;
}

export async function listBoltOrders(
  workspaceId: string,
  input: { q?: string; page?: number; limit?: number; driverUuids?: string[] }
) {
  const page = Math.max(0, input.page ?? 0);
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const driverFilter =
    input.driverUuids != null
      ? input.driverUuids.length
        ? { driverUuid: { in: input.driverUuids } }
        : { id: { in: [] as string[] } }
      : undefined;
  const where = boltBillableOrderWhere(workspaceId, {
    ...(driverFilter ?? {}),
    ...(input.q
      ? textOr(input.q, ['orderReference', 'driverName', 'vehicleModel', 'vehicleLicensePlate'])
      : {}),
  });

  const [total, orders] = await Promise.all([
    prisma.boltOrder.count({ where }),
    prisma.boltOrder.findMany({
      where,
      orderBy: { orderCreatedTimestamp: 'desc' },
      skip: page * limit,
      take: limit,
      include: { _count: { select: { stops: true } } },
    }),
  ]);

  return {
    items: orders.map((o) => ({
      id: o.id,
      orderReference: o.orderReference,
      driverName: o.driverName,
      orderStatus: o.orderStatus,
      vehicleModel: o.vehicleModel,
      ridePrice: o.ridePrice?.toString() ?? null,
      orderCreatedTimestamp: o.orderCreatedTimestamp,
      boltCompanyId: o.boltCompanyId,
      isPaid: o.isPaid,
      paymentDate: o.paymentDate?.toISOString() ?? null,
      stopsCount: o._count.stops,
    })),
    total,
    page,
    limit,
  };
}

export async function getBoltDashboardStats(
  workspaceId: string,
  options?: { driverUuids?: string[]; monthKey?: string }
) {
  const driverFilter =
    options?.driverUuids != null
      ? options.driverUuids.length
        ? { driverUuid: { in: options.driverUuids } }
        : { id: { in: [] as string[] } }
      : undefined;
  const billableWhere = boltBillableOrderWhere(workspaceId, driverFilter);
  const { start, endExclusive, key } = getMonthUtcRange(options?.monthKey);

  const [ordersCount, driversCount, vehiclesCount, revenueAgg, monthAgg, recentOrders] =
    await Promise.all([
      prisma.boltOrder.count({ where: billableWhere }),
      options?.driverUuids != null
        ? prisma.boltDriver.count({
            where: {
              workspaceId,
              ...(options.driverUuids.length
                ? { driverUuid: { in: options.driverUuids } }
                : { id: { in: [] as string[] } }),
            },
          })
        : prisma.boltDriver.count({ where: { workspaceId } }),
      options?.driverUuids != null
        ? Promise.resolve(0)
        : prisma.boltVehicle.count({ where: { workspaceId } }),
      prisma.boltOrder.aggregate({
        where: billableWhere,
        _sum: { ridePrice: true },
      }),
      prisma.boltOrder.aggregate({
        where: {
          ...billableWhere,
          orderCreatedTimestamp: { gte: start, lt: endExclusive },
        },
        _sum: { ridePrice: true },
      }),
      prisma.boltOrder.findMany({
        where: billableWhere,
        orderBy: { orderCreatedTimestamp: 'desc' },
        take: 10,
        select: {
          id: true,
          orderReference: true,
          driverName: true,
          orderStatus: true,
          vehicleModel: true,
          ridePrice: true,
          orderCreatedTimestamp: true,
          isPaid: true,
          _count: { select: { stops: true } },
        },
      }),
    ]);

  return {
    ordersCount,
    driversCount,
    vehiclesCount,
    totalRevenue: revenueAgg._sum.ridePrice?.toString() ?? '0',
    monthTotal: monthAgg._sum.ridePrice?.toString() ?? '0',
    selectedMonth: key,
    recentOrders: recentOrders.map((o) => ({
      ...o,
      ridePrice: o.ridePrice?.toString() ?? null,
      stopsCount: o._count.stops,
    })),
  };
}

import { prisma } from '@tvde/database';
import { Prisma } from '@prisma/client';
import {
  computeSyncWindow,
  type BoltOrderStop,
  type BoltSyncCounters,
  type BoltSyncType,
} from '@tvde/bolt';
import { formatWeekDate, getMonthUtcRange, getWeekRange, parseWeekQuery } from '@tvde/shared';
import { textOr } from './search.service';
import { ensureBoltClient, getBoltConnection } from './bolt-connection.service';

/** Corridas com valor a pagar ao motorista (líquido Fleet). */
export function boltBillableOrderWhere(
  workspaceId: string,
  extra?: Prisma.BoltOrderWhereInput
): Prisma.BoltOrderWhereInput {
  const billable: Prisma.BoltOrderWhereInput = {
    OR: [
      {
        orderStatus: 'finished',
        OR: [{ payoutAmount: { gt: 0 } }, { ridePrice: { not: null, gt: 0 } }],
      },
      {
        orderStatus: 'client_cancelled',
        payoutAmount: { gt: 0 },
      },
    ],
  };
  return {
    workspaceId,
    AND: extra ? [billable, extra] : [billable],
  };
}

/** Valor a pagar: net_earnings + tip + toll (fallback ride_price). */
export function boltOrderPayoutDecimal(order: {
  payoutAmount?: Prisma.Decimal | null;
  netEarnings?: Prisma.Decimal | null;
  tip?: Prisma.Decimal | null;
  tollFee?: Prisma.Decimal | null;
  ridePrice?: Prisma.Decimal | null;
}): number {
  if (order.payoutAmount != null) return Number(order.payoutAmount.toString());
  const net = order.netEarnings != null ? Number(order.netEarnings.toString()) : null;
  if (net != null) {
    const tip = order.tip != null ? Number(order.tip.toString()) : 0;
    const toll = order.tollFee != null ? Number(order.tollFee.toString()) : 0;
    return net + tip + toll;
  }
  return order.ridePrice != null ? Number(order.ridePrice.toString()) : 0;
}

function computePayoutAmount(input: {
  netEarnings: Prisma.Decimal | null;
  tip: Prisma.Decimal | null;
  tollFee: Prisma.Decimal | null;
  ridePrice: Prisma.Decimal | null;
}): Prisma.Decimal | null {
  if (input.netEarnings != null) {
    const tip = input.tip ? Number(input.tip.toString()) : 0;
    const toll = input.tollFee ? Number(input.tollFee.toString()) : 0;
    return new Prisma.Decimal(
      (Math.round((Number(input.netEarnings.toString()) + tip + toll) * 100) / 100).toFixed(2)
    );
  }
  return input.ridePrice;
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
    const bookingFee = toDecimal(order.order_price?.booking_fee);
    const tollFee = toDecimal(order.order_price?.toll_fee);
    const tip = toDecimal(order.order_price?.tip);
    const commission = toDecimal(order.order_price?.commission);
    const netEarnings = toDecimal(order.order_price?.net_earnings);
    const ridePriceDec = toDecimal(ridePrice);
    const payoutAmount = computePayoutAmount({
      netEarnings,
      tip,
      tollFee,
      ridePrice: ridePriceDec,
    });
    const data = {
      boltCompanyId: companyId,
      driverName: order.driver_name ?? null,
      driverUuid: order.driver_uuid ?? null,
      driverPhone: order.driver_phone ?? null,
      orderStatus: order.order_status ?? null,
      vehicleModel: order.vehicle_model ?? null,
      vehicleLicensePlate: order.vehicle_license_plate ?? null,
      orderCreatedTimestamp: tsToDate(order.order_created_timestamp),
      ridePrice: ridePriceDec,
      bookingFee,
      tollFee,
      tip,
      commission,
      netEarnings,
      payoutAmount,
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
    where: { isActive: true, autoSyncEnabled: true, boltCompanyId: { not: null } },
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

function parseOrderDateFilter(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const dt = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

export async function listBoltOrders(
  workspaceId: string,
  input: {
    q?: string;
    page?: number;
    limit?: number;
    driverUuids?: string[];
    startDate?: string;
    endDate?: string;
  }
) {
  const page = Math.max(0, input.page ?? 0);
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const driverFilter =
    input.driverUuids != null
      ? input.driverUuids.length
        ? { driverUuid: { in: input.driverUuids } }
        : { id: { in: [] as string[] } }
      : undefined;
  const start = parseOrderDateFilter(input.startDate);
  const end = parseOrderDateFilter(input.endDate);
  let orderCreatedTimestamp: Prisma.DateTimeNullableFilter | undefined;
  if (start || end) {
    orderCreatedTimestamp = {};
    if (start) orderCreatedTimestamp.gte = start;
    if (end) {
      const endOfDay = new Date(end);
      endOfDay.setUTCHours(23, 59, 59, 999);
      orderCreatedTimestamp.lte = endOfDay;
    }
  }
  const where = boltBillableOrderWhere(workspaceId, {
    ...(driverFilter ?? {}),
    ...(input.q
      ? textOr(input.q, ['orderReference', 'driverName', 'vehicleModel', 'vehicleLicensePlate'])
      : {}),
    ...(orderCreatedTimestamp ? { orderCreatedTimestamp } : {}),
  });

  const [total, orders, sumAgg] = await Promise.all([
    prisma.boltOrder.count({ where }),
    prisma.boltOrder.findMany({
      where,
      orderBy: { orderCreatedTimestamp: 'desc' },
      skip: page * limit,
      take: limit,
      include: { _count: { select: { stops: true } } },
    }),
    prisma.boltOrder.aggregate({
      where,
      _sum: { payoutAmount: true, ridePrice: true },
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
      payoutAmount: o.payoutAmount?.toString() ?? null,
      netEarnings: o.netEarnings?.toString() ?? null,
      orderCreatedTimestamp: o.orderCreatedTimestamp,
      boltCompanyId: o.boltCompanyId,
      isPaid: o.isPaid,
      paymentDate: o.paymentDate?.toISOString() ?? null,
      stopsCount: o._count.stops,
    })),
    total,
    /** Soma do líquido a pagar (payout_amount; fallback ride_price se legado). */
    filteredTotal: (
      sumAgg._sum.payoutAmount ??
      sumAgg._sum.ridePrice ??
      0
    ).toString(),
    page,
    limit,
  };
}

export async function getBoltDashboardStats(
  workspaceId: string,
  options?: {
    driverUuids?: string[];
    monthKey?: string;
    weekYear?: string | number;
    week?: string | number;
  }
) {
  const driverFilter =
    options?.driverUuids != null
      ? options.driverUuids.length
        ? { driverUuid: { in: options.driverUuids } }
        : { id: { in: [] as string[] } }
      : undefined;
  const billableWhere = boltBillableOrderWhere(workspaceId, driverFilter);
  const { start, endExclusive, key } = getMonthUtcRange(options?.monthKey);
  const { year: wYear, week: wNum } = parseWeekQuery(options?.weekYear, options?.week);
  const weekRange = getWeekRange(wYear, wNum);

  const [ordersCount, driversCount, vehiclesCount, revenueAgg, monthAgg, weekAgg, recentOrders] =
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
        _sum: { payoutAmount: true, ridePrice: true },
      }),
      prisma.boltOrder.aggregate({
        where: {
          ...billableWhere,
          orderCreatedTimestamp: { gte: start, lt: endExclusive },
        },
        _sum: { payoutAmount: true, ridePrice: true },
      }),
      prisma.boltOrder.aggregate({
        where: {
          ...billableWhere,
          orderCreatedTimestamp: { gte: weekRange.start, lt: weekRange.endExclusive },
        },
        _sum: { payoutAmount: true, ridePrice: true },
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
          payoutAmount: true,
          orderCreatedTimestamp: true,
          isPaid: true,
          _count: { select: { stops: true } },
        },
      }),
    ]);

  const pickSum = (agg: { _sum: { payoutAmount: Prisma.Decimal | null; ridePrice: Prisma.Decimal | null } }) =>
    (agg._sum.payoutAmount ?? agg._sum.ridePrice)?.toString() ?? '0';

  return {
    ordersCount,
    driversCount,
    vehiclesCount,
    totalRevenue: pickSum(revenueAgg),
    monthTotal: pickSum(monthAgg),
    selectedMonth: key,
    weekNumber: weekRange.week,
    weekYear: weekRange.year,
    weekTotal: pickSum(weekAgg),
    weekStart: formatWeekDate(weekRange.start),
    weekEnd: formatWeekDate(weekRange.end),
    recentOrders: recentOrders.map((o) => ({
      ...o,
      ridePrice: (o.payoutAmount ?? o.ridePrice)?.toString() ?? null,
      stopsCount: o._count.stops,
    })),
  };
}

export async function markBoltOrderPaid(workspaceId: string, orderId: string) {
  const existing = await prisma.boltOrder.findFirst({
    where: { id: orderId, workspaceId },
  });
  if (!existing) throw new Error('Pedido não encontrado');

  return prisma.boltOrder.update({
    where: { id: orderId },
    data: { isPaid: true, paymentDate: new Date() },
  });
}

export async function bulkMarkBoltOrdersPaid(workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) throw new Error('Seleccione pelo menos um pedido');

  const result = await prisma.boltOrder.updateMany({
    where: { workspaceId, id: { in: unique }, isPaid: false },
    data: { isPaid: true, paymentDate: new Date() },
  });

  return { updated: result.count, requested: unique.length };
}

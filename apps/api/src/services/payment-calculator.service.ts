import type { PrismaClient, UserVehicle } from '@prisma/client';
import {
  defaultPaymentWeekRange,
  isUserVehicleActive,
  overlapDays,
  toDateOnlyUtc,
  type PaymentCalculation,
  type PaymentDriverOption,
  type PaymentMoneyLine,
} from '@tvde/shared';
import { getOpenContaCorrenteForDriver } from './driver-current-account.service';

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function dec(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

function endOfDayUtc(dateOnly: Date): Date {
  return new Date(
    Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), dateOnly.getUTCDate(), 23, 59, 59, 999)
  );
}

/** Melhor viatura por chave (uuid / matrícula) segundo sobreposição com o período. */
function pickBestByKey(
  vehicles: UserVehicle[],
  getKey: (v: UserVehicle) => string | null | undefined,
  periodStart: Date,
  periodEnd: Date
): Map<string, UserVehicle> {
  const best = new Map<string, { vehicle: UserVehicle; days: number }>();

  for (const vehicle of vehicles) {
    const raw = getKey(vehicle)?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const days = overlapDays(vehicle.dataInicio, vehicle.dataFim, periodStart, periodEnd, periodEnd);
    if (days <= 0) continue;

    const current = best.get(key);
    if (!current || days > current.days) {
      best.set(key, { vehicle, days });
      continue;
    }
    if (days === current.days && vehicle.dataFim && !current.vehicle.dataFim) {
      best.set(key, { vehicle, days });
    }
  }

  return new Map([...best.entries()].map(([k, v]) => [k, v.vehicle]));
}

export async function listPaymentDrivers(
  db: PrismaClient,
  tenantId: string
): Promise<PaymentDriverOption[]> {
  const users = await db.user.findMany({
    where: {
      tenantId,
      role: { not: 'master' },
      vehicles: { some: {} },
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      _count: { select: { vehicles: true } },
    },
    orderBy: [{ fullName: 'asc' }, { username: 'asc' }, { email: 'asc' }],
  });

  return users.map((u) => ({
    id: u.id,
    label: u.fullName || u.username || u.email || u.id,
    email: u.email,
    username: u.username,
    vehicleCount: u._count.vehicles,
  }));
}

export async function calculateDriverPayment(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  periodStartInput?: string,
  periodEndInput?: string,
  options?: { viaVerdeIds?: string[] }
): Promise<PaymentCalculation> {
  const defaults = defaultPaymentWeekRange();
  const periodStartStr = periodStartInput || defaults.periodStart;
  const periodEndStr = periodEndInput || defaults.periodEnd;
  const periodStart = toDateOnlyUtc(periodStartStr);
  const periodEnd = toDateOnlyUtc(periodEndStr);
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new Error('Data de fim anterior à data de início');
  }

  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, fullName: true, username: true, email: true },
  });
  if (!user) throw new Error('Motorista não encontrado neste tenant');

  const vehicles = await db.userVehicle.findMany({
    where: { userId, tenantId },
    orderBy: { dataInicio: 'asc' },
  });

  const warnings: string[] = [];
  const detalhes = {
    uber: [] as PaymentMoneyLine[],
    bolt: [] as PaymentMoneyLine[],
    viaVerde: [] as PaymentMoneyLine[],
    eletricidade: [] as PaymentMoneyLine[],
    combustivel: [] as PaymentMoneyLine[],
    comissao: [] as PaymentMoneyLine[],
    iva6: [] as PaymentMoneyLine[],
    contaCorrente: [] as PaymentMoneyLine[],
  };

  const ids = {
    viaVerdeMovementIds: [] as string[],
    electricityChargeIds: [] as string[],
    fuelTransactionIds: [] as string[],
    uberPaymentIds: [] as string[],
    boltOrderIds: [] as string[],
    driverExpenseIds: [] as string[],
  };

  // ── Receitas Uber / Bolt (UUID com melhor sobreposição; só em aberto) ────
  const uberByUuid = pickBestByKey(vehicles, (v) => v.uuidUber, periodStart, periodEnd);
  const boltByUuid = pickBestByKey(vehicles, (v) => v.uuidBolt, periodStart, periodEnd);

  let uberTotal = 0;
  for (const [, vehicle] of uberByUuid) {
    const rows = await db.uberPayment.findMany({
      where: {
        tenantId,
        isPaid: false,
        driverUuid: { equals: vehicle.uuidUber!, mode: 'insensitive' },
        reportDate: { gte: periodStart, lte: endOfDayUtc(periodEnd) },
      },
      select: { id: true, amount: true, reportDate: true },
    });
    const sum = rows.reduce((acc, r) => acc + dec(r.amount), 0);
    uberTotal += sum;
    ids.uberPaymentIds.push(...rows.map((r) => r.id));
    detalhes.uber.push({
      label: `Uber · ${vehicle.matricula} · ${vehicle.uuidUber}`,
      amount: money(sum),
      meta: `${rows.length} linhas em aberto`,
    });
  }

  let boltTotal = 0;
  for (const [, vehicle] of boltByUuid) {
    const rows = await db.boltOrder.findMany({
      where: {
        tenantId,
        isPaid: false,
        driverUuid: { equals: vehicle.uuidBolt!, mode: 'insensitive' },
        orderStatus: 'finished',
        ridePrice: { not: null, gt: 0 },
        orderCreatedTimestamp: {
          gte: periodStart,
          lte: endOfDayUtc(periodEnd),
        },
      },
      select: { id: true, ridePrice: true, orderReference: true },
    });
    const sum = rows.reduce((acc, r) => acc + dec(r.ridePrice), 0);
    boltTotal += sum;
    ids.boltOrderIds.push(...rows.map((r) => r.id));
    detalhes.bolt.push({
      label: `Bolt · ${vehicle.matricula} · ${vehicle.uuidBolt}`,
      amount: money(sum),
      meta: `${rows.length} corridas (ride_price · em aberto)`,
    });
  }
  if (boltByUuid.size === 0 && vehicles.some((v) => v.uuidBolt?.trim())) {
    warnings.push(
      'Bolt: UUID presente nas viaturas mas sem sobreposição com o período — receita Bolt = 0.'
    );
  }

  const totalReceitas = uberTotal + boltTotal;

  // ── Via Verde: movimentos em aberto das matrículas activas hoje ──────────
  const now = new Date();
  const activeVehicles = vehicles.filter((v) => isUserVehicleActive(v.dataFim, now));
  const plates = [
    ...new Set(activeVehicles.map((v) => v.matricula.trim()).filter(Boolean)),
  ];

  let viaVerdeTotal = 0;
  if (options?.viaVerdeIds?.length) {
    const rows = await db.viaVerdeMovement.findMany({
      where: { tenantId, id: { in: options.viaVerdeIds } },
      select: { id: true, value: true, licensePlate: true, entryDate: true },
    });
    viaVerdeTotal = rows.reduce((acc, r) => acc + dec(r.value), 0);
    ids.viaVerdeMovementIds = rows.map((r) => r.id);
    for (const r of rows) {
      detalhes.viaVerde.push({
        label: `VV · ${r.licensePlate}`,
        amount: money(dec(r.value)),
        meta: r.entryDate ? r.entryDate.toISOString().slice(0, 10) : undefined,
      });
    }
  } else if (plates.length) {
    const unpaid = await db.viaVerdeMovement.findMany({
      where: {
        tenantId,
        licensePlate: { in: plates },
        isPaid: false,
      },
      select: { id: true, value: true, licensePlate: true, entryDate: true },
    });
    viaVerdeTotal = unpaid.reduce((acc, r) => acc + dec(r.value), 0);
    ids.viaVerdeMovementIds = unpaid.map((r) => r.id);
    const byPlate = new Map<string, number>();
    for (const r of unpaid) {
      byPlate.set(r.licensePlate, (byPlate.get(r.licensePlate) ?? 0) + dec(r.value));
    }
    for (const [plate, sum] of byPlate) {
      detalhes.viaVerde.push({
        label: `Via Verde · ${plate}`,
        amount: money(sum),
        meta: 'movimentos em aberto (sem filtro de data)',
      });
    }
  }

  // ── Eletricidade / Combustível (filtro de datas do relatório) ────────────
  let elecTotal = 0;
  let fuelTotal = 0;
  const cards = [
    ...new Set(
      activeVehicles
        .map((v) => v.numCartaoPrio?.trim())
        .filter((c): c is string => Boolean(c))
    ),
  ];
  const names = [
    ...new Set(
      activeVehicles
        .map((v) => v.nomeCompleto?.trim())
        .filter((n): n is string => Boolean(n))
    ),
  ];

  if (cards.length || names.length) {
    const elecWhere =
      cards.length && names.length
        ? {
            tenantId,
            isPaid: false,
            chargeDate: { gte: periodStart, lte: periodEnd },
            OR: [{ cardNumber: { in: cards } }, { name: { in: names } }],
          }
        : cards.length
          ? {
              tenantId,
              isPaid: false,
              chargeDate: { gte: periodStart, lte: periodEnd },
              cardNumber: { in: cards },
            }
          : {
              tenantId,
              isPaid: false,
              chargeDate: { gte: periodStart, lte: periodEnd },
              name: { in: names },
            };

    const elecRows = await db.electricityCharge.findMany({
      where: elecWhere,
      select: { id: true, totalWithVat: true, cardNumber: true, name: true, chargeDate: true },
    });
    elecTotal = elecRows.reduce((acc, r) => acc + dec(r.totalWithVat), 0);
    ids.electricityChargeIds = elecRows.map((r) => r.id);
    if (elecRows.length) {
      detalhes.eletricidade.push({
        label: 'Eletricidade (PRIO)',
        amount: money(elecTotal),
        meta: `${elecRows.length} carregamentos`,
      });
    }
  }

  if (cards.length) {
    const fuelRows = await db.fuelTransaction.findMany({
      where: {
        tenantId,
        isPaid: false,
        cardNumber: { in: cards },
        chargeDate: { gte: periodStart, lte: endOfDayUtc(periodEnd) },
      },
      select: { id: true, totalWithVat: true, cardNumber: true, chargeDate: true },
    });
    fuelTotal = fuelRows.reduce((acc, r) => acc + dec(r.totalWithVat), 0);
    ids.fuelTransactionIds = fuelRows.map((r) => r.id);
    if (fuelRows.length) {
      detalhes.combustivel.push({
        label: 'Combustível (PRIO)',
        amount: money(fuelTotal),
        meta: `${fuelRows.length} abastecimentos`,
      });
    }
  }

  // ── Comissões (viaturas activas hoje; 1 registo por matrícula) ───────────
  const commissionByPlate = pickBestByKey(
    activeVehicles,
    (v) => v.matricula,
    periodStart,
    periodEnd
  );

  let comissaoTotal = 0;
  /** Checkbox IVA 6% = taxa administrativa sobre receitas Uber/Bolt (discriminada), não sobre a comissão. */
  let applyIva6OnRevenues = false;

  for (const [, vehicle] of commissionByPlate) {
    const tipo = vehicle.comissaoTipo;
    const valor = dec(vehicle.comissaoValor);
    const legacyAluguel = dec(vehicle.aluguelViatura);

    if (vehicle.comissaoIva6) {
      applyIva6OnRevenues = true;
    }

    if (!tipo && legacyAluguel > 0) {
      comissaoTotal += legacyAluguel;
      detalhes.comissao.push({
        label: `Aluguer (legacy) · ${vehicle.matricula}`,
        amount: money(legacyAluguel),
      });
      continue;
    }

    if (!tipo || valor <= 0) continue;

    if (tipo === 'fixa') {
      comissaoTotal += valor;
      detalhes.comissao.push({
        label: `Comissão fixa · ${vehicle.matricula}`,
        amount: money(valor),
      });
    } else if (tipo === 'percentagem') {
      let base = totalReceitas;
      if (!vehicle.slotIncluirViaVerde) base -= viaVerdeTotal;
      if (!vehicle.slotIncluirEletricidadeCombustivel) base -= elecTotal + fuelTotal;
      if (base < 0) base = 0;
      const line = (base * valor) / 100;
      comissaoTotal += line;
      detalhes.comissao.push({
        label: `Comissão ${valor}% · ${vehicle.matricula}`,
        amount: money(line),
        meta: `base ${money(base)}`,
      });
    } else if (tipo === 'slot') {
      comissaoTotal += valor;
      detalhes.comissao.push({
        label: `Slot · ${vehicle.matricula}`,
        amount: money(valor),
      });
    }
  }

  let iva6Uber = 0;
  let iva6Bolt = 0;
  if (applyIva6OnRevenues) {
    iva6Uber = uberTotal * 0.06;
    iva6Bolt = boltTotal * 0.06;
    if (iva6Uber > 0 || uberTotal > 0) {
      detalhes.iva6.push({
        label: 'IVA 6% · Uber',
        amount: money(iva6Uber),
        meta: `6% de ${money(uberTotal)}`,
      });
    }
    if (iva6Bolt > 0 || boltTotal > 0) {
      detalhes.iva6.push({
        label: 'IVA 6% · Bolt',
        amount: money(iva6Bolt),
        meta: `6% de ${money(boltTotal)}`,
      });
    }
  }
  const iva6Receitas = iva6Uber + iva6Bolt;

  // Conta corrente — lançamentos em aberto (+ parcela se parcelado)
  const ccSlice = await getOpenContaCorrenteForDriver(db, tenantId, userId);
  const contaCorrente = ccSlice.impact;
  detalhes.contaCorrente.push(...ccSlice.details);
  ids.driverExpenseIds.push(...ccSlice.entryIds);

  const totalDespesas =
    viaVerdeTotal + elecTotal + fuelTotal + comissaoTotal + iva6Receitas + contaCorrente;
  const resultado = totalReceitas - totalDespesas;

  if (!vehicles.length) {
    warnings.push('Motorista sem viaturas — receitas/despesas por UUID/matrícula/cartão ficam a 0.');
  }

  return {
    userId: user.id,
    userLabel: user.fullName || user.username || user.email || user.id,
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    receitas: {
      uber: money(uberTotal),
      bolt: money(boltTotal),
      total: money(totalReceitas),
    },
    despesas: {
      viaVerde: money(viaVerdeTotal),
      eletricidade: money(elecTotal),
      combustivel: money(fuelTotal),
      comissaoViatura: money(comissaoTotal),
      iva6Receitas: money(iva6Receitas),
      iva6Uber: money(iva6Uber),
      iva6Bolt: money(iva6Bolt),
      contaCorrente: money(contaCorrente),
      total: money(totalDespesas),
    },
    resultado: money(resultado),
    detalhes,
    ids,
    warnings,
  };
}

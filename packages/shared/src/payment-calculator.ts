/**
 * Cálculo de pagamentos semanais aos motoristas.
 * Regra de negócio: docs/ficheiros de exemplo/PAYMENT_CALCULATOR.md
 * · Receitas: Uber + Bolt
 * · Despesas: Via Verde (abertos) + Eletricidade + Combustível + Comissão + Conta corrente
 * · Resultado = receitas − despesas
 */

/**
 * Última semana completa segunda→domingo (Europe/Lisbon).
 * Se hoje é domingo, essa semana já terminou → devolve seg→dom desta semana.
 * De segunda a sábado → devolve a semana anterior (seg→dom).
 */
export function defaultPaymentWeekRange(now: Date = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
      .formatToParts(now)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = weekdayMap[parts.weekday ?? 'Mon'] ?? 1;

  // Último domingo concluído: se hoje é domingo, é hoje; senão, o domingo anterior
  const daysSinceSunday = weekday;
  const lastSunday = new Date(Date.UTC(year, month - 1, day));
  lastSunday.setUTCDate(lastSunday.getUTCDate() - daysSinceSunday);
  const lastMonday = new Date(lastSunday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 6);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { periodStart: fmt(lastMonday), periodEnd: fmt(lastSunday) };
}

/**
 * Janela Uber «Rendimentos» para somar linhas «Pago a si».
 * Portal: segunda 04:00 → segunda seguinte 03:59 (Europe/Lisbon).
 * Os CSV Uber guardam o relógio de parede em `timestamp without time zone`
 * (import no servidor UTC = componentes 04:00 tal como no portal). O corte usa
 * hora 04:00 nos componentes UTC do Date — alinhado aos dados em BD.
 * Período seg→dom: [periodStart 04:00, (periodEnd+1) 04:00).
 */
export function uberPaymentOrderDateRange(
  periodStartYmd: string,
  periodEndYmd: string
): { gte: Date; lt: Date } {
  const start = periodStartYmd.trim();
  const end = periodEndYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('Datas de período inválidas');
  }
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const nextDay = new Date(Date.UTC(ey, em - 1, ed + 1));
  return {
    gte: new Date(Date.UTC(sy, sm - 1, sd, 4, 0, 0, 0)),
    lt: new Date(
      Date.UTC(nextDay.getUTCFullYear(), nextDay.getUTCMonth(), nextDay.getUTCDate(), 4, 0, 0, 0)
    ),
  };
}

export interface PaymentMoneyLine {
  label: string;
  amount: string;
  meta?: string;
}

export interface PaymentCalculationReceitas {
  uber: string;
  bolt: string;
  total: string;
}

export interface PaymentCalculationDespesas {
  viaVerde: string;
  eletricidade: string;
  combustivel: string;
  comissaoViatura: string;
  /** Soma IVA 6% Uber + Bolt */
  iva6Receitas: string;
  /** 6% sobre receitas Uber (discriminado) */
  iva6Uber: string;
  /** 6% sobre receitas Bolt (discriminado) */
  iva6Bolt: string;
  contaCorrente: string;
  total: string;
}

export interface PaymentCalculationIds {
  viaVerdeMovementIds: string[];
  electricityChargeIds: string[];
  fuelTransactionIds: string[];
  uberPaymentIds: string[];
  boltOrderIds: string[];
  /** Lançamentos de conta corrente aplicados neste cálculo */
  driverExpenseIds: string[];
}

export interface PaymentCalculation {
  userId: string;
  userLabel: string;
  periodStart: string;
  periodEnd: string;
  receitas: PaymentCalculationReceitas;
  despesas: PaymentCalculationDespesas;
  /** total_receitas − total_despesas */
  resultado: string;
  detalhes: {
    uber: PaymentMoneyLine[];
    bolt: PaymentMoneyLine[];
    viaVerde: PaymentMoneyLine[];
    eletricidade: PaymentMoneyLine[];
    combustivel: PaymentMoneyLine[];
    comissao: PaymentMoneyLine[];
    iva6: PaymentMoneyLine[];
    contaCorrente: PaymentMoneyLine[];
  };
  ids: PaymentCalculationIds;
  warnings: string[];
}

export interface PaymentDriverOption {
  id: string;
  label: string;
  email: string | null;
  username: string | null;
  vehicleCount: number;
}

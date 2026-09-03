import type { PrismaClient } from '@prisma/client';
import { getServerConfig } from '@tvde/shared/server';
import {
  EMAIL_TEMPLATE_KEYS,
  EmailNotConfiguredError,
  sendTemplateEmail,
} from './email.service';
import { buildBaseEmailVariables } from './email-design-tokens';
import { buildCompanyLogoHtml } from './tenant-branding.service';
import { PAYMENT_REPORT_IVA6_EMAIL_TEMPLATE } from './payment-report-iva6-email-template';
import { resolveFleetContactEmail } from './payment-report-email.service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoneyPt(value: number | string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return '€ 0,00';
  return `€ ${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDatePt(ymdStr: string): string {
  if (!ymdStr) return '—';
  return new Date(`${ymdStr}T12:00:00`).toLocaleDateString('pt-PT');
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function money(n: number): string {
  return n.toFixed(2);
}

/** IVA 6% sobre receitas totais (Uber + Bolt). */
export function computeAdminIva6Receitas(receitasTotal: number): {
  receitasTotal: number;
  ivaAmount: number;
  diferencaAmount: number;
} {
  const ivaAmount = Math.round(receitasTotal * 0.06 * 100) / 100;
  const diferencaAmount = Math.round((receitasTotal - ivaAmount) * 100) / 100;
  return { receitasTotal, ivaAmount, diferencaAmount };
}

export type SendPaymentReportIva6EmailOpts = {
  includeCarro?: boolean;
  /** Valor base do carro (ex.: 300) — Semana do Carro = base − IVA 6% */
  carroBase?: number;
};

export async function sendPaymentReportIva6Email(
  db: PrismaClient,
  tenantId: string,
  reportId: string,
  to: string,
  opts: SendPaymentReportIva6EmailOpts = {}
): Promise<{
  sentAt: string;
  to: string;
  receitasTotal: string;
  ivaAmount: string;
  diferencaAmount: string;
  includeCarro: boolean;
  carroBase: string | null;
  carroAmount: string | null;
}> {
  const report = await db.paymentReport.findFirst({
    where: { id: reportId, tenantId },
    include: {
      user: { select: { fullName: true, username: true, email: true } },
      tenant: { select: { name: true } },
    },
  });
  if (!report) throw new Error('Pagamento não encontrado');

  const recipient = to.trim();
  if (!recipient) throw new Error('Indique um endereço de email');

  const includeCarro = Boolean(opts.includeCarro);
  let carroBase: number | null = null;
  let carroAmount: number | null = null;
  if (includeCarro) {
    const base = Number(opts.carroBase);
    if (!Number.isFinite(base) || base < 0) {
      throw new Error('Indique um valor do carro válido');
    }
    carroBase = Math.round(base * 100) / 100;
  }

  const { appName } = getServerConfig();
  const companyName = report.tenant.name || appName;
  const companyEmail = await resolveFleetContactEmail(db, tenantId);
  if (!companyEmail) {
    throw new Error(
      'Email de contacto da frota não configurado — configure SMTP em Definições ou o email do gestor de frota'
    );
  }

  const driverName =
    report.user.fullName || report.user.username || report.user.email || 'Motorista';

  const receitas = Number(report.receitasUber.toString()) + Number(report.receitasBolt.toString());
  const { ivaAmount, diferencaAmount } = computeAdminIva6Receitas(receitas);

  if (includeCarro && carroBase != null) {
    carroAmount = Math.round((carroBase - ivaAmount) * 100) / 100;
  }

  const periodStart = formatDatePt(toYmd(report.periodStart));
  const periodEnd = formatDatePt(toYmd(report.periodEnd));

  const { html: companyLogoHtml, attachment: logoAttachment } =
    await buildCompanyLogoHtml(tenantId, companyName);

  const resultadoLabel =
    includeCarro && carroAmount != null ? 'Semana do Carro' : 'Diferença (receitas − IVA)';
  const resultadoAmount =
    includeCarro && carroAmount != null
      ? formatMoneyPt(carroAmount)
      : formatMoneyPt(diferencaAmount);

  const variables: Record<string, string> = {
    ...buildBaseEmailVariables({
      appName,
      supportEmail: companyEmail,
    }),
    companyName,
    companyEmail,
    companyLogoHtml,
    driverName: escapeHtml(driverName),
    periodStart,
    periodEnd,
    receitasTotal: formatMoneyPt(receitas),
    ivaAmount: formatMoneyPt(ivaAmount),
    diferencaAmount: formatMoneyPt(diferencaAmount),
    resultadoLabel,
    resultadoAmount,
  };

  const emailAttachments = logoAttachment ? [logoAttachment] : undefined;

  try {
    await sendTemplateEmail({
      tenantId,
      to: recipient,
      templateKey: EMAIL_TEMPLATE_KEYS.paymentReportIva6,
      variables,
      fromName: companyName,
      attachments: emailAttachments,
    });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) throw err;
    throw err;
  }

  const sentAt = new Date();
  await db.paymentReport.update({
    where: { id: reportId },
    data: {
      adminIvaReceitas6: money(ivaAmount),
      adminIvaReceitasSentAt: sentAt,
      adminIvaReceitasSentTo: recipient,
    },
  });

  return {
    sentAt: sentAt.toISOString(),
    to: recipient,
    receitasTotal: money(receitas),
    ivaAmount: money(ivaAmount),
    diferencaAmount: money(diferencaAmount),
    includeCarro,
    carroBase: carroBase != null ? money(carroBase) : null,
    carroAmount: carroAmount != null ? money(carroAmount) : null,
  };
}

import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { getServerConfig } from '@tvde/shared/server';
import type { PaymentMoneyLine } from '@tvde/shared';
import {
  EMAIL_TEMPLATE_KEYS,
  EmailNotConfiguredError,
  resolveSmtpConnection,
  sendTemplateEmail,
} from './email.service';
import { buildBaseEmailVariables } from './email-design-tokens';
import { buildCompanyLogoHtml } from './tenant-branding.service';
import { getPaymentReceiptPath } from './payment-report-attachment-storage.service';
import { PAYMENT_REPORT_EMAIL_TEMPLATE } from './payment-report-email-template';

const EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const ZERO_EPS = 0.005;

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

function isNearZero(value: number): boolean {
  return Math.abs(value) < ZERO_EPS;
}

export type PaymentReportCardItem = {
  label: string;
  amount: number;
  valueColor: string;
};

/** Card neutro (sem bordos arco-íris) — alinhado ao visual invoice/stripe. */
function buildCardCell(item: PaymentReportCardItem): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:0.5px solid #e2e8f0;border-radius:8px;">
  <tr>
    <td style="padding:14px 10px;text-align:center;">
      <p style="margin:0;font-size:11px;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(item.label)}</p>
      <p style="margin:8px 0 0;font-size:18px;font-weight:600;color:${item.valueColor};">${formatMoneyPt(Math.abs(item.amount))}</p>
    </td>
  </tr>
</table>`;
}

/** Grelha 2 colunas — só recebe itens já filtrados (valor significativo). */
export function buildPaymentReportCardsHtml(items: PaymentReportCardItem[]): string {
  if (items.length === 0) return '';

  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i]!;
    const right = items[i + 1];
    if (right) {
      rows.push(`<tr>
  <td width="50%" valign="top" style="padding:6px;">${buildCardCell(left)}</td>
  <td width="50%" valign="top" style="padding:6px;">${buildCardCell(right)}</td>
</tr>`);
    } else {
      rows.push(`<tr>
  <td width="50%" valign="top" style="padding:6px;">${buildCardCell(left)}</td>
  <td width="50%" valign="top" style="padding:6px;"></td>
</tr>`);
    }
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
${rows.join('\n')}
</table>`;
}

/**
 * Conta corrente — omitir por completo quando ≈ 0.
 * Linhas: descrição/categoria reais do settlement (detailsJson), não texto genérico.
 */
export function buildContaCorrenteEmailBlocks(input: {
  despesasContaCorrente: number;
  lines?: PaymentMoneyLine[] | null;
}): { cardItem: PaymentReportCardItem | null; detailsHtml: string } {
  const cc = input.despesasContaCorrente;
  if (isNearZero(cc)) {
    return { cardItem: null, detailsHtml: '' };
  }

  const isCredito = cc < 0;
  const label = isCredito ? 'Conta corrente (Crédito)' : 'Conta corrente (Débito)';
  const valueColor = isCredito ? '#166534' : '#92400e';

  const lines = (input.lines ?? []).filter((line) => {
    const n = Number(line.amount);
    return Number.isFinite(n) && !isNearZero(n);
  });

  let detailsBody: string;
  if (lines.length > 0) {
    detailsBody = lines
      .map((line) => {
        const amt = Number(line.amount);
        const amtColor = amt < 0 ? '#166534' : '#92400e';
        const meta = line.meta ? ` <span style="color:#94a3b8;">(${escapeHtml(line.meta)})</span>` : '';
        return `<p style="margin:0 0 8px;font-size:13px;color:#334155;line-height:1.45;">
  <strong>${escapeHtml(line.label)}</strong>${meta}
  — <span style="color:${amtColor};font-weight:600;">${formatMoneyPt(Math.abs(amt))}</span>
</p>`;
      })
      .join('');
  } else {
    const detailLabel = isCredito ? 'Crédito' : 'Débito';
    detailsBody = `<p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">
  <strong style="color:${valueColor};">${detailLabel}:</strong>
  ${formatMoneyPt(Math.abs(cc))}
</p>`;
  }

  return {
    cardItem: {
      label,
      amount: Math.abs(cc),
      valueColor,
    },
    detailsHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background:#ffffff;border:0.5px solid #e2e8f0;border-radius:8px;">
  <tr>
    <td style="padding:14px 16px;">
      <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#334155;">Detalhes conta corrente</p>
      ${detailsBody}
    </td>
  </tr>
</table>`,
  };
}

/**
 * Email de contacto da frota/empresa — nunca o email do motorista.
 * Ordem: SMTP do tenant/plataforma → gestor de frota (superadmin) → SMTP_FROM do .env.
 */
export async function resolveFleetContactEmail(
  db: PrismaClient,
  tenantId: string
): Promise<string> {
  try {
    const smtp = await resolveSmtpConnection(tenantId);
    const from = smtp.from?.trim();
    if (from) return from;
  } catch {
    /* SMTP ainda não configurado */
  }

  const fleetManager = await db.user.findFirst({
    where: { tenantId, role: 'superadmin', status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  });
  const fleetEmail = fleetManager?.email?.trim();
  if (fleetEmail) return fleetEmail;

  const { smtpFrom } = getServerConfig();
  return smtpFrom?.trim() || '';
}

export async function sendPaymentReportEmail(
  db: PrismaClient,
  tenantId: string,
  reportId: string,
  opts?: { includeAttachments?: boolean }
): Promise<{
  lastSentAt: string;
  to: string;
  attachmentsIncluded: number;
  attachmentsSkipped: boolean;
}> {
  const report = await db.paymentReport.findFirst({
    where: { id: reportId, tenantId },
    include: {
      user: { select: { fullName: true, username: true, email: true } },
      tenant: { select: { name: true } },
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          fileName: true,
          storageKey: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  });
  if (!report) throw new Error('Pagamento não encontrado');

  const to = report.user.email?.trim();
  if (!to) throw new Error('O motorista não tem email configurado');

  const { appName, webPublicUrl } = getServerConfig();
  const companyName = report.tenant.name || appName;
  const companyEmail = await resolveFleetContactEmail(db, tenantId);
  if (!companyEmail) {
    throw new Error(
      'Email de contacto da frota não configurado — configure SMTP em Definições ou o email do gestor de frota'
    );
  }
  // Nunca usar o email do motorista como contacto
  if (companyEmail.toLowerCase() === to.toLowerCase()) {
    throw new Error(
      'Email de contacto da frota inválido (coincide com o do motorista) — configure SMTP da empresa'
    );
  }

  const driverName =
    report.user.fullName || report.user.username || report.user.email || 'Motorista';

  const periodStart = formatDatePt(toYmd(report.periodStart));
  const periodEnd = formatDatePt(toYmd(report.periodEnd));
  const resultado = Number(report.resultadoFinal.toString());
  const totalColor = resultado >= 0 ? '#166534' : '#dc2626';

  const uber = Number(report.receitasUber.toString());
  const bolt = Number(report.receitasBolt.toString());
  const viaVerde = Number(report.despesasViaVerde.toString());
  const eletricidade = Number(report.despesasEletricidade.toString());
  const combustivel = Number(report.despesasCombustivel.toString());
  const comissao = Number(report.despesasComissao.toString());
  const iva6 = Number(report.despesasIva6.toString());
  const cc = Number(report.despesasContaCorrente.toString());

  const incomeColor = '#0f172a';
  const expenseColor = '#dc2626';

  const cards: PaymentReportCardItem[] = [];
  if (!isNearZero(uber)) {
    cards.push({ label: 'Uber', amount: uber, valueColor: incomeColor });
  }
  if (!isNearZero(bolt)) {
    cards.push({ label: 'Bolt', amount: bolt, valueColor: incomeColor });
  }
  if (!isNearZero(viaVerde)) {
    cards.push({ label: 'Via Verde', amount: viaVerde, valueColor: expenseColor });
  }
  if (!isNearZero(eletricidade)) {
    cards.push({ label: 'Eletricidade', amount: eletricidade, valueColor: expenseColor });
  }
  if (!isNearZero(combustivel)) {
    cards.push({ label: 'Combustível', amount: combustivel, valueColor: expenseColor });
  }
  if (!isNearZero(comissao)) {
    cards.push({ label: 'Comissão viatura', amount: comissao, valueColor: expenseColor });
  }
  // IVA 6%: só quando há valor — omitir se ≈ 0
  if (!isNearZero(iva6)) {
    cards.push({ label: 'IVA 6% (receitas)', amount: iva6, valueColor: expenseColor });
  }

  const detailsJson =
    report.detailsJson && typeof report.detailsJson === 'object'
      ? (report.detailsJson as { contaCorrente?: PaymentMoneyLine[] })
      : null;
  const ccLines = Array.isArray(detailsJson?.contaCorrente) ? detailsJson!.contaCorrente! : [];

  const ccBlocks = buildContaCorrenteEmailBlocks({
    despesasContaCorrente: cc,
    lines: ccLines,
  });
  if (ccBlocks.cardItem) cards.push(ccBlocks.cardItem);

  const cardsHtml = buildPaymentReportCardsHtml(cards);

  const portalLoginUrl = webPublicUrl
    ? `${webPublicUrl.replace(/\/$/, '')}/login`
    : '';
  const portalLoginButtonHtml = portalLoginUrl
    ? `<div class="cta-wrap">
  <a href="${portalLoginUrl}" class="btn-portal" style="display:inline-block;background:#534AB7;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:500;">Área de Cliente</a>
</div>`
    : '';

  const { html: companyLogoHtml, attachment: logoAttachment } =
    await buildCompanyLogoHtml(tenantId, companyName);

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
    cardsHtml,
    contaCorrenteDetailsHtml: ccBlocks.detailsHtml,
    totalValue: formatMoneyPt(resultado),
    totalColor,
    portalLoginUrl,
    portalLoginButtonHtml,
  };

  const emailAttachments: Array<{ filename: string; content: Buffer; cid?: string }> = [];
  if (logoAttachment) emailAttachments.push(logoAttachment);

  let attachmentsIncluded = 0;
  let attachmentsSkipped = false;
  const includeAttachments = opts?.includeAttachments !== false;

  if (includeAttachments && report.attachments.length > 0) {
    let totalBytes = 0;
    const pending: Array<{ filename: string; content: Buffer }> = [];
    for (const att of report.attachments) {
      const size = Number(att.sizeBytes);
      if (totalBytes + size > EMAIL_ATTACHMENTS_MAX_TOTAL_BYTES) {
        attachmentsSkipped = true;
        break;
      }
      try {
        const content = await readFile(getPaymentReceiptPath(att.storageKey));
        pending.push({ filename: att.fileName, content });
        totalBytes += content.length;
      } catch {
        attachmentsSkipped = true;
      }
    }
    emailAttachments.push(...pending);
    attachmentsIncluded = pending.length;
  }

  try {
    await sendTemplateEmail({
      tenantId,
      to,
      templateKey: EMAIL_TEMPLATE_KEYS.paymentReport,
      variables,
      fromName: companyName,
      attachments: emailAttachments.length ? emailAttachments : undefined,
    });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) throw err;
    throw err;
  }

  const renderedHtml = PAYMENT_REPORT_EMAIL_TEMPLATE.htmlBody.replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => variables[key] ?? ''
  );

  const lastSentAt = new Date();
  await db.paymentReport.update({
    where: { id: reportId },
    data: {
      lastSentAt,
      reportHtml: renderedHtml,
    },
  });

  return {
    lastSentAt: lastSentAt.toISOString(),
    to,
    attachmentsIncluded,
    attachmentsSkipped,
  };
}

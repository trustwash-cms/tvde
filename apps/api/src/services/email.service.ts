import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { z } from 'zod';
import { prisma } from '@tvde/database';
import { EMAIL_DEFAULT_BCC_KEY, EMAIL_DEFAULT_CC_KEY } from '@tvde/shared';
import { getServerConfig } from '@tvde/shared/server';
import { decrypt, encrypt } from '../lib/crypto';
import { INVOICE_EMAIL_TEMPLATE } from './invoice-email-template';
import { CALENDAR_APPOINTMENT_TEMPLATE } from './calendar-appointment-email-template';
import { CARWASH_COMPLETION_TEMPLATE } from './carwash-completion-email-template';
import { BOOKING_CONFIRMATION_TEMPLATE } from './booking-confirmation-email-template';
import { TENANT_DELETE_EMAIL_TEMPLATE } from './tenant-delete-email-template';
import {
  CARWASH_ACTION_CONFIRMATION_EMAIL_TEMPLATE,
  CARWASH_ACTION_REQUEST_EMAIL_TEMPLATE,
} from './carwash-authorization-email-template';
import { TENANT_WELCOME_EMAIL_TEMPLATE } from './tenant-welcome-email-template';
import { TWO_FA_EMAIL_TEMPLATE } from './two-fa-email-template';
import { STRIPE_PAYMENT_EMAIL_TEMPLATE } from './stripe-payment-email-template';
import { buildBaseEmailVariables } from './email-design-tokens';

export const EMAIL_TEMPLATE_KEYS = {
  invoice: 'invoice',
  passwordReset: 'password_reset',
  calendarAppointment: 'calendar_appointment',
  carwashPickup: 'carwash_pickup',
  carwashCompletion: 'carwash_completion',
  stripePayment: 'stripe_payment',
  tenantDeleteConfirmation: 'tenant_delete_confirmation',
  carwashActionConfirmation: 'carwash_action_confirmation',
  carwashActionRequest: 'carwash_action_request',
  tenantWelcome: 'tenant_welcome',
  twoFaEmail: 'two_fa_email',
  bookingConfirmation: 'booking_confirmation',
  ecommerceOrderConfirmation: 'ecommerce_order_confirmation',
} as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[keyof typeof EMAIL_TEMPLATE_KEYS];

export type SmtpScope = 'tenant' | 'platform';

export class EmailNotConfiguredError extends Error {
  constructor(message = 'SMTP não configurado') {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

interface SmtpConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  from: string;
  fromName: string | null;
  source: 'tenant' | 'platform' | 'env';
}

interface SendEmailInput {
  tenantId?: string | null;
  to: string;
  subject: string;
  html: string;
  /** Nome visível na caixa de entrada (ex.: «ARC», «Edições19deAbril»). */
  fromName?: string | null;
  attachments?: Array<{ filename: string; content: Buffer; cid?: string }>;
}

interface SendTemplateEmailInput {
  tenantId?: string | null;
  to: string;
  templateKey: EmailTemplateKey;
  variables: Record<string, string>;
  fromName?: string | null;
  attachments?: Array<{ filename: string; content: Buffer; cid?: string }>;
}

const DEFAULT_TEMPLATES: Record<
  EmailTemplateKey,
  { subject: string; htmlBody: string; variables: string[] }
> = {
  password_reset: {
    subject: 'Redefinir password — {{appName}}',
    htmlBody: `<!DOCTYPE html>
<html lang="pt">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
  <h2>Redefinir password</h2>
  <p>Olá {{userName}},</p>
  <p>Recebemos um pedido para redefinir a password da sua conta em <strong>{{appName}}</strong>.</p>
  <p><a href="{{resetUrl}}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Redefinir password</a></p>
  <p style="font-size:14px;color:#64748b">Este link expira em {{expiresIn}}. Se não fez este pedido, ignore este email.</p>
  <p style="font-size:12px;color:#94a3b8;word-break:break-all">{{resetUrl}}</p>
</body>
</html>`,
    variables: ['appName', 'resetUrl', 'userName', 'expiresIn'],
  },
  invoice: {
    subject: INVOICE_EMAIL_TEMPLATE.subject,
    htmlBody: INVOICE_EMAIL_TEMPLATE.htmlBody,
    variables: INVOICE_EMAIL_TEMPLATE.variables,
  },
  calendar_appointment: {
    subject: CALENDAR_APPOINTMENT_TEMPLATE.subject,
    htmlBody: CALENDAR_APPOINTMENT_TEMPLATE.htmlBody,
    variables: [...CALENDAR_APPOINTMENT_TEMPLATE.variables],
  },
  carwash_pickup: {
    subject: 'Confirme o levantamento do veículo — {{companyName}}',
    htmlBody: `<!DOCTYPE html>
<html lang="pt">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
  <h2>Levantamento do veículo</h2>
  <p>Olá {{customerName}},</p>
  <p>O serviço da folha de obra <strong>{{workSheetReference}}</strong> está concluído{{vehicleLabel}}.</p>
  <p>Confirme que levantou o veículo assinando no link abaixo:</p>
  <p><a href="{{pickupUrl}}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Assinar levantamento</a></p>
  <p style="font-size:14px;color:#64748b">Este link expira em {{expiresIn}} e deixa de funcionar após a assinatura.</p>
  <p style="font-size:12px;color:#94a3b8;word-break:break-all">{{pickupUrl}}</p>
  <p style="font-size:12px;color:#94a3b8">{{companyName}} · {{appName}}</p>
</body>
</html>`,
    variables: ['appName', 'customerName', 'companyName', 'workSheetReference', 'vehicleLabel', 'pickupUrl', 'expiresIn'],
  },
  carwash_completion: {
    subject: CARWASH_COMPLETION_TEMPLATE.subject,
    htmlBody: CARWASH_COMPLETION_TEMPLATE.htmlBody,
    variables: [...CARWASH_COMPLETION_TEMPLATE.variables],
  },
  stripe_payment: {
    subject: STRIPE_PAYMENT_EMAIL_TEMPLATE.subject,
    htmlBody: STRIPE_PAYMENT_EMAIL_TEMPLATE.htmlBody,
    variables: [...STRIPE_PAYMENT_EMAIL_TEMPLATE.variables],
  },
  tenant_delete_confirmation: {
    subject: TENANT_DELETE_EMAIL_TEMPLATE.subject,
    htmlBody: TENANT_DELETE_EMAIL_TEMPLATE.htmlBody,
    variables: [...TENANT_DELETE_EMAIL_TEMPLATE.variables],
  },
  carwash_action_confirmation: {
    subject: CARWASH_ACTION_CONFIRMATION_EMAIL_TEMPLATE.subject,
    htmlBody: CARWASH_ACTION_CONFIRMATION_EMAIL_TEMPLATE.htmlBody,
    variables: [...CARWASH_ACTION_CONFIRMATION_EMAIL_TEMPLATE.variables],
  },
  carwash_action_request: {
    subject: CARWASH_ACTION_REQUEST_EMAIL_TEMPLATE.subject,
    htmlBody: CARWASH_ACTION_REQUEST_EMAIL_TEMPLATE.htmlBody,
    variables: [...CARWASH_ACTION_REQUEST_EMAIL_TEMPLATE.variables],
  },
  tenant_welcome: {
    subject: TENANT_WELCOME_EMAIL_TEMPLATE.subject,
    htmlBody: TENANT_WELCOME_EMAIL_TEMPLATE.htmlBody,
    variables: [...TENANT_WELCOME_EMAIL_TEMPLATE.variables],
  },
  two_fa_email: {
    subject: TWO_FA_EMAIL_TEMPLATE.subject,
    htmlBody: TWO_FA_EMAIL_TEMPLATE.htmlBody,
    variables: [...TWO_FA_EMAIL_TEMPLATE.variables],
  },
  booking_confirmation: {
    subject: BOOKING_CONFIRMATION_TEMPLATE.subject,
    htmlBody: BOOKING_CONFIRMATION_TEMPLATE.htmlBody,
    variables: [...BOOKING_CONFIRMATION_TEMPLATE.variables],
  },
  ecommerce_order_confirmation: {
    subject: 'Encomenda {{orderNumber}} — {{appName}}',
    htmlBody: `<!DOCTYPE html><html lang="pt"><body><p>Confirmação de encomenda {{orderNumber}}.</p></body></html>`,
    variables: ['appName', 'orderNumber'],
  },
};

function smtpOwnerFilter(tenantId: string | null) {
  return tenantId === null ? { tenantId: null } : { tenantId };
}

function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? '');
}

/** Cabeçalho From: «Nome da Loja» <email@dominio.pt> */
export function formatEmailFromAddress(email: string, displayName?: string | null): string {
  const raw = email.trim();
  if (!raw) return raw;

  const formatted = /^(.+?)\s*<([^>]+)>$/.exec(raw);
  const addr = (formatted?.[2] ?? raw).trim();
  const embeddedName = formatted?.[1]?.replace(/^["']|["']$/g, '').trim();
  const name = displayName?.trim() || embeddedName;
  if (!name) return addr;

  const safeName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${safeName}" <${addr}>`;
}

const emailAddressSchema = z.string().email();

/** Comma/semicolon-separated list → unique valid emails (throws on invalid). */
export function parseEmailListInput(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  const invalid: string[] = [];
  const valid: string[] = [];

  for (const part of parts) {
    if (emailAddressSchema.safeParse(part).success) valid.push(part);
    else invalid.push(part);
  }

  if (invalid.length > 0) {
    throw new Error(`Emails inválidos: ${invalid.join(', ')}`);
  }

  return [...new Set(valid)];
}

function parseStoredEmailList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    return parseEmailListInput(raw);
  } catch {
    return [];
  }
}

function formatEmailListForStorage(emails: string[]): string {
  return emails.join(', ');
}

async function readEmailRoutingFromStore(ownerTenantId: string | null) {
  if (ownerTenantId === null) {
    const rows = await prisma.platformSetting.findMany({
      where: { key: { in: [EMAIL_DEFAULT_CC_KEY, EMAIL_DEFAULT_BCC_KEY] } },
    });
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      defaultCc: map.get(EMAIL_DEFAULT_CC_KEY) ?? '',
      defaultBcc: map.get(EMAIL_DEFAULT_BCC_KEY) ?? '',
    };
  }

  const rows = await prisma.tenantSetting.findMany({
    where: {
      tenantId: ownerTenantId,
      key: { in: [EMAIL_DEFAULT_CC_KEY, EMAIL_DEFAULT_BCC_KEY] },
    },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    defaultCc: map.get(EMAIL_DEFAULT_CC_KEY) ?? '',
    defaultBcc: map.get(EMAIL_DEFAULT_BCC_KEY) ?? '',
  };
}

async function resolveDefaultEmailCopies(tenantId?: string | null) {
  const ownerTenantId = tenantId ?? null;
  const routing = await readEmailRoutingFromStore(ownerTenantId);
  return {
    cc: parseStoredEmailList(routing.defaultCc),
    bcc: parseStoredEmailList(routing.defaultBcc),
  };
}

function mergeCopyRecipients(
  to: string,
  cc: string[],
  bcc: string[]
): { cc?: string[]; bcc?: string[] } {
  const toLower = to.trim().toLowerCase();
  const ccFiltered = cc.filter((email) => email.toLowerCase() !== toLower);
  const ccLower = new Set(ccFiltered.map((email) => email.toLowerCase()));
  const bccFiltered = bcc.filter(
    (email) => email.toLowerCase() !== toLower && !ccLower.has(email.toLowerCase())
  );

  return {
    ...(ccFiltered.length > 0 ? { cc: ccFiltered } : {}),
    ...(bccFiltered.length > 0 ? { bcc: bccFiltered } : {}),
  };
}

async function resolveStoredSmtp(
  tenantId: string | null,
  source: 'tenant' | 'platform'
): Promise<SmtpConnection | null> {
  const row = await prisma.smtpConfig.findFirst({
    where: { ...smtpOwnerFilter(tenantId), isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;

  const { smtpFrom } = getServerConfig();
  return {
    host: row.host,
    port: row.port,
    username: row.username,
    password: decrypt(row.encryptedPassword),
    tls: row.tls,
    from: smtpFrom || row.username,
    fromName: row.fromName?.trim() || null,
    source,
  };
}

function resolveEnvSmtp(): SmtpConnection | null {
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, appName } = getServerConfig();
  if (!smtpHost || !smtpUser || !smtpPass) return null;

  return {
    host: smtpHost,
    port: smtpPort,
    username: smtpUser,
    password: smtpPass,
    tls: smtpPort !== 465,
    from: smtpFrom || smtpUser,
    fromName: appName || null,
    source: 'env',
  };
}

/** Tenant → plataforma (DB) → .env */
export async function resolveSmtpConnection(tenantId?: string | null): Promise<SmtpConnection> {
  if (tenantId) {
    const tenantSmtp = await resolveStoredSmtp(tenantId, 'tenant');
    if (tenantSmtp) return tenantSmtp;
  }

  const platformSmtp = await resolveStoredSmtp(null, 'platform');
  if (platformSmtp) return platformSmtp;

  const envSmtp = resolveEnvSmtp();
  if (envSmtp) return envSmtp;

  throw new EmailNotConfiguredError();
}

function createTransport(config: SmtpConnection): Transporter {
  const secure = config.port === 465;
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    requireTLS: !secure && config.tls,
    tls: {
      rejectUnauthorized: getServerConfig().nodeEnv === 'production',
    },
  });
}

export async function sendEmail(input: SendEmailInput): Promise<{ messageId: string; source: string }> {
  const smtp = await resolveSmtpConnection(input.tenantId);
  const transport = createTransport(smtp);
  const defaultCopies = await resolveDefaultEmailCopies(input.tenantId);
  const copies = mergeCopyRecipients(input.to, defaultCopies.cc, defaultCopies.bcc);
  const fromName = input.fromName ?? smtp.fromName ?? getServerConfig().appName;

  const info = await transport.sendMail({
    from: formatEmailFromAddress(smtp.from, fromName),
    to: input.to,
    ...copies,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  });

  return { messageId: info.messageId, source: smtp.source };
}

export async function getEmailTemplate(
  tenantId: string | null | undefined,
  templateKey: EmailTemplateKey
) {
  if (tenantId) {
    const tenantTemplate = await prisma.emailTemplate.findUnique({
      where: { tenantId_key: { tenantId, key: templateKey } },
    });
    if (tenantTemplate) return tenantTemplate;
  }

  const platformTemplate = await prisma.emailTemplate.findFirst({
    where: { tenantId: null, key: templateKey },
  });
  if (platformTemplate) return platformTemplate;

  const fallback = DEFAULT_TEMPLATES[templateKey];
  return {
    key: templateKey,
    subject: fallback.subject,
    htmlBody: fallback.htmlBody,
    variables: fallback.variables,
  };
}

export async function sendTemplateEmail(input: SendTemplateEmailInput) {
  const template = await getEmailTemplate(input.tenantId, input.templateKey);
  const subject = renderTemplate(template.subject, input.variables);
  const html = renderTemplate(template.htmlBody, input.variables);

  return sendEmail({
    tenantId: input.tenantId,
    to: input.to,
    subject,
    html,
    fromName: input.fromName ?? input.variables.appName ?? getServerConfig().appName,
    attachments: input.attachments,
  });
}

export async function sendPasswordResetEmail(input: {
  tenantId?: string | null;
  to: string;
  resetUrl: string;
  userName?: string;
}) {
  const { appName, passwordResetExpiresMs } = getServerConfig();
  const expiresIn = `${Math.round(passwordResetExpiresMs / 3_600_000)} hora(s)`;

  return sendTemplateEmail({
    tenantId: input.tenantId,
    to: input.to,
    templateKey: EMAIL_TEMPLATE_KEYS.passwordReset,
    variables: {
      appName,
      resetUrl: input.resetUrl,
      userName: input.userName ?? input.to.split('@')[0],
      expiresIn,
    },
  });
}

export async function sendTwoFaEmail(input: {
  tenantId?: string | null;
  to: string;
  code: string;
  expiresInMinutes?: number;
}) {
  const { appName } = getServerConfig();
  const smtp = await resolveSmtpConnection(input.tenantId);
  const expiresInMinutes = input.expiresInMinutes ?? 10;

  return sendTemplateEmail({
    tenantId: input.tenantId,
    to: input.to,
    templateKey: EMAIL_TEMPLATE_KEYS.twoFaEmail,
    variables: {
      ...buildBaseEmailVariables({ appName, supportEmail: smtp.from }),
      confirmationCode: input.code,
      expiresIn: `${expiresInMinutes} minutos`,
    },
  });
}

export async function sendTenantDeleteConfirmationEmail(input: {
  to: string;
  tenantName: string;
  tenantSiteId: string;
  confirmationCode: string;
  expiresInMinutes?: number;
}) {
  const { appName } = getServerConfig();
  const smtp = await resolveSmtpConnection(null);
  const expiresInMinutes = input.expiresInMinutes ?? 10;

  return sendTemplateEmail({
    tenantId: null,
    to: input.to,
    templateKey: EMAIL_TEMPLATE_KEYS.tenantDeleteConfirmation,
    variables: {
      ...buildBaseEmailVariables({ appName, supportEmail: smtp.from }),
      tenantName: input.tenantName,
      tenantSiteId: input.tenantSiteId,
      confirmationCode: input.confirmationCode,
      expiresIn: `${expiresInMinutes} minutos`,
    },
  });
}

export async function sendCarwashActionConfirmationEmail(input: {
  to: string;
  actionLabel: string;
  workSheetReference: string;
  workSheetTitle: string;
  confirmationCode: string;
  expiresInMinutes?: number;
}) {
  const { appName } = getServerConfig();
  const smtp = await resolveSmtpConnection(null);
  const expiresInMinutes = input.expiresInMinutes ?? 10;

  return sendTemplateEmail({
    tenantId: null,
    to: input.to,
    templateKey: EMAIL_TEMPLATE_KEYS.carwashActionConfirmation,
    variables: {
      ...buildBaseEmailVariables({ appName, supportEmail: smtp.from }),
      actionLabel: input.actionLabel,
      workSheetReference: input.workSheetReference,
      workSheetTitle: input.workSheetTitle,
      confirmationCode: input.confirmationCode,
      expiresIn: String(expiresInMinutes),
    },
  });
}

export async function sendCarwashActionRequestEmail(input: {
  tenantId: string | null;
  to: string;
  actionLabel: string;
  workSheetReference: string;
  workSheetTitle: string;
  requesterEmail: string;
}) {
  const { appName } = getServerConfig();
  const smtp = await resolveSmtpConnection(input.tenantId);

  return sendTemplateEmail({
    tenantId: input.tenantId,
    to: input.to,
    templateKey: EMAIL_TEMPLATE_KEYS.carwashActionRequest,
    variables: {
      ...buildBaseEmailVariables({ appName, supportEmail: smtp.from }),
      actionLabel: input.actionLabel,
      workSheetReference: input.workSheetReference,
      workSheetTitle: input.workSheetTitle,
      requesterEmail: input.requesterEmail,
    },
  });
}

export async function sendTenantWelcomeEmail(input: {
  to: string;
  tenantName: string;
  tenantSiteId: string;
  adminEmail: string;
  temporaryPassword: string;
}) {
  const { appName, webPublicUrl } = getServerConfig();
  const smtp = await resolveSmtpConnection(null);
  const loginUrl = webPublicUrl ? `${webPublicUrl.replace(/\/$/, '')}/login` : '/login';

  return sendTemplateEmail({
    tenantId: null,
    to: input.to,
    templateKey: EMAIL_TEMPLATE_KEYS.tenantWelcome,
    variables: {
      ...buildBaseEmailVariables({ appName, supportEmail: smtp.from }),
      tenantName: input.tenantName,
      tenantSiteId: input.tenantSiteId,
      adminEmail: input.adminEmail,
      temporaryPassword: input.temporaryPassword,
      loginUrl,
      expiresIn: '24 horas',
    },
  });
}

export function resolveSmtpScopeForUser(role: string, tenantId: string | null): {
  scope: SmtpScope;
  ownerTenantId: string | null;
} {
  if (role === 'master') {
    return { scope: 'platform', ownerTenantId: null };
  }
  if (!tenantId) {
    throw new Error('Utilizador sem tenant');
  }
  return { scope: 'tenant', ownerTenantId: tenantId };
}

export async function getSmtpPublicInfo(ownerTenantId: string | null) {
  const row = await prisma.smtpConfig.findFirst({
    where: { ...smtpOwnerFilter(ownerTenantId), isActive: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      host: true,
      port: true,
      username: true,
      fromName: true,
      tls: true,
      provider: true,
      isActive: true,
      createdAt: true,
    },
  });

  const env = resolveEnvSmtp();
  const platform = ownerTenantId
    ? await prisma.smtpConfig.findFirst({
        where: { tenantId: null, isActive: true },
        select: { id: true },
      })
    : null;

  const emailRouting = await readEmailRoutingFromStore(ownerTenantId);

  return {
    scope: ownerTenantId === null ? ('platform' as const) : ('tenant' as const),
    configured: Boolean(row || env),
    smtpConfig: row,
    usingEnvFallback: !row && Boolean(env),
    usingPlatformFallback: Boolean(ownerTenantId && !row && platform),
    emailRouting,
  };
}

export async function upsertEmailRoutingSettings(
  ownerTenantId: string | null,
  input: { defaultCc?: string; defaultBcc?: string }
) {
  const updates: Array<{ key: string; value: string }> = [];

  if (input.defaultCc !== undefined) {
    const cc = parseEmailListInput(input.defaultCc);
    updates.push({ key: EMAIL_DEFAULT_CC_KEY, value: formatEmailListForStorage(cc) });
  }
  if (input.defaultBcc !== undefined) {
    const bcc = parseEmailListInput(input.defaultBcc);
    updates.push({ key: EMAIL_DEFAULT_BCC_KEY, value: formatEmailListForStorage(bcc) });
  }

  for (const { key, value } of updates) {
    if (ownerTenantId === null) {
      if (!value) {
        await prisma.platformSetting.deleteMany({ where: { key } });
      } else {
        await prisma.platformSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      }
    } else if (!value) {
      await prisma.tenantSetting.deleteMany({
        where: { tenantId: ownerTenantId, key },
      });
    } else {
      await prisma.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: ownerTenantId, key } },
        create: { tenantId: ownerTenantId, key, value },
        update: { value },
      });
    }
  }

  return readEmailRoutingFromStore(ownerTenantId);
}

export async function upsertSmtpConfig(
  ownerTenantId: string | null,
  input: {
    host: string;
    port: number;
    username: string;
    password?: string;
    tls: boolean;
    fromName?: string | null;
  }
) {
  const existing = await prisma.smtpConfig.findFirst({
    where: { ...smtpOwnerFilter(ownerTenantId), isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  let encryptedPassword = existing?.encryptedPassword;
  if (input.password) {
    encryptedPassword = encrypt(input.password);
  }
  if (!encryptedPassword) {
    throw new Error('Password SMTP obrigatória');
  }

  await prisma.smtpConfig.updateMany({
    where: { ...smtpOwnerFilter(ownerTenantId), isActive: true },
    data: { isActive: false },
  });

  return prisma.smtpConfig.create({
    data: {
      tenantId: ownerTenantId,
      host: input.host,
      port: input.port,
      username: input.username,
      encryptedPassword,
      fromName: input.fromName?.trim() || null,
      tls: input.tls,
      isActive: true,
    },
    select: {
      id: true,
      host: true,
      port: true,
      username: true,
      fromName: true,
      tls: true,
      provider: true,
      isActive: true,
      createdAt: true,
    },
  });
}

export async function listEmailTemplates(ownerTenantId: string | null) {
  const rows = await prisma.emailTemplate.findMany({
    where: smtpOwnerFilter(ownerTenantId),
    orderBy: { key: 'asc' },
  });

  const keys = Object.values(EMAIL_TEMPLATE_KEYS).filter(
    (key) => key !== EMAIL_TEMPLATE_KEYS.calendarAppointment
  );
  return keys.map((key) => {
    const custom = rows.find((r) => r.key === key);
    const fallback = DEFAULT_TEMPLATES[key];
    return (
      custom ?? {
        key,
        subject: fallback.subject,
        htmlBody: fallback.htmlBody,
        variables: fallback.variables,
        isDefault: true as const,
      }
    );
  });
}

export async function upsertEmailTemplate(
  ownerTenantId: string | null,
  key: EmailTemplateKey,
  input: { subject: string; htmlBody: string }
) {
  const fallback = DEFAULT_TEMPLATES[key];
  const existing = await prisma.emailTemplate.findFirst({
    where: { ...smtpOwnerFilter(ownerTenantId), key },
  });

  if (existing) {
    return prisma.emailTemplate.update({
      where: { id: existing.id },
      data: { subject: input.subject, htmlBody: input.htmlBody },
    });
  }

  return prisma.emailTemplate.create({
    data: {
      tenantId: ownerTenantId,
      key,
      subject: input.subject,
      htmlBody: input.htmlBody,
      variables: fallback.variables,
    },
  });
}

export { DEFAULT_TEMPLATES };

import { prisma } from '@tvde/database';
import { getServerConfig } from '@tvde/shared/server';
import { canDecrypt, decrypt, encrypt, isCryptoAuthFailure } from '../lib/crypto';
import {
  EmailNotConfiguredError,
  resolveSmtpConnection,
  sendEmail,
  renderEmailTemplate,
  parseEmailListInput,
  type SmtpConnection,
} from './email.service';
import { INVOICE_EMAIL_TEMPLATE } from './invoice-email-template';
import { splitAppNameForEmail } from './email-design-tokens';
import { getBillingConnection } from './moloni-connection.service';

/** Mensagem PT quando ENCRYPTION_KEY mudou ou ciphertext SMTP de facturação está corrompido. */
export const BILLING_SMTP_CRYPTO_RESAVE_MESSAGE =
  'Password SMTP de facturação ilegível (ENCRYPTION_KEY alterada ou dados corrompidos). ' +
  'Volte a colar a password em Configurações → Moloni → Email de faturas e guarde.';

export type BillingEmailPublicSettings = {
  brandName: string | null;
  footerText: string | null;
  supportEmail: string | null;
  /** Cópia oculta (BCC) opcional em todos os emails de faturas. */
  emailBcc: string | null;
  smtpConfigured: boolean;
  /** Password SMTP encriptada ilegível — é preciso voltar a colá-la e guardar. */
  smtpNeedsResave: boolean;
  smtp: {
    host: string | null;
    port: number | null;
    username: string | null;
    fromEmail: string | null;
    fromName: string | null;
    tls: boolean;
  } | null;
  /** Indica se branding próprio está preenchido (fallback será usado se false). */
  brandingConfigured: boolean;
};

export type BillingEmailBrand = {
  brandName: string;
  brandNamePrefix: string;
  brandNameSuffix: string;
  footerText: string;
  supportEmail: string;
  fromName: string;
};

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function getBillingEmailPublicSettings(
  workspaceId: string
): Promise<BillingEmailPublicSettings> {
  const row = await getBillingConnection(workspaceId);
  if (!row) {
    return {
      brandName: null,
      footerText: null,
      supportEmail: null,
      emailBcc: null,
      smtpConfigured: false,
      smtpNeedsResave: false,
      smtp: null,
      brandingConfigured: false,
    };
  }

  const hasSmtpPassword = Boolean(row.emailSmtpEncryptedPassword);
  const smtpPasswordReadable = canDecrypt(row.emailSmtpEncryptedPassword);
  const smtpNeedsResave = hasSmtpPassword && !smtpPasswordReadable;
  const smtpConfigured = Boolean(
    row.emailSmtpHost && row.emailSmtpUsername && hasSmtpPassword && smtpPasswordReadable
  );
  const smtpFields =
    row.emailSmtpHost || row.emailSmtpUsername
      ? {
          host: row.emailSmtpHost,
          port: row.emailSmtpPort,
          username: row.emailSmtpUsername,
          fromEmail: row.emailSmtpFromEmail,
          fromName: row.emailSmtpFromName,
          tls: row.emailSmtpTls,
        }
      : null;
  return {
    brandName: row.emailBrandName,
    footerText: row.emailFooterText,
    supportEmail: row.emailSupportEmail,
    emailBcc: row.emailBcc,
    smtpConfigured,
    smtpNeedsResave,
    smtp: smtpFields,
    brandingConfigured: Boolean(row.emailBrandName?.trim()),
  };
}

export async function upsertBillingEmailSettings(
  workspaceId: string,
  input: {
    brandName?: string | null;
    footerText?: string | null;
    supportEmail?: string | null;
    emailBcc?: string | null;
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpUsername?: string | null;
    smtpPassword?: string | null;
    smtpFromEmail?: string | null;
    smtpFromName?: string | null;
    smtpTls?: boolean;
    clearSmtpPassword?: boolean;
  }
) {
  const existing = await getBillingConnection(workspaceId);
  if (!existing) {
    throw new Error('Configure primeiro as credenciais Moloni neste workspace');
  }

  let encryptedPassword = existing.emailSmtpEncryptedPassword;
  if (input.clearSmtpPassword) {
    encryptedPassword = null;
  } else if (input.smtpPassword) {
    encryptedPassword = encrypt(input.smtpPassword);
  }

  await prisma.billingConnection.update({
    where: { workspaceId },
    data: {
      ...(input.brandName !== undefined ? { emailBrandName: emptyToNull(input.brandName) } : {}),
      ...(input.footerText !== undefined ? { emailFooterText: emptyToNull(input.footerText) } : {}),
      ...(input.supportEmail !== undefined
        ? { emailSupportEmail: emptyToNull(input.supportEmail) }
        : {}),
      ...(input.emailBcc !== undefined ? { emailBcc: emptyToNull(input.emailBcc) } : {}),
      ...(input.smtpHost !== undefined ? { emailSmtpHost: emptyToNull(input.smtpHost) } : {}),
      ...(input.smtpPort !== undefined ? { emailSmtpPort: input.smtpPort } : {}),
      ...(input.smtpUsername !== undefined
        ? { emailSmtpUsername: emptyToNull(input.smtpUsername) }
        : {}),
      ...(input.smtpPassword !== undefined || input.clearSmtpPassword
        ? { emailSmtpEncryptedPassword: encryptedPassword }
        : {}),
      ...(input.smtpFromEmail !== undefined
        ? { emailSmtpFromEmail: emptyToNull(input.smtpFromEmail) }
        : {}),
      ...(input.smtpFromName !== undefined
        ? { emailSmtpFromName: emptyToNull(input.smtpFromName) }
        : {}),
      ...(input.smtpTls !== undefined ? { emailSmtpTls: input.smtpTls } : {}),
    },
  });

  return getBillingEmailPublicSettings(workspaceId);
}

/** BCC configurado no workspace de facturação (vazio = sem BCC). */
export async function resolveBillingEmailBcc(workspaceId: string): Promise<string[]> {
  const row = await getBillingConnection(workspaceId);
  const raw = emptyToNull(row?.emailBcc ?? null);
  if (!raw) return [];
  try {
    return parseEmailListInput(raw);
  } catch {
    // Valor legado inválido — não bloquear envio da fatura.
    return [];
  }
}

function decryptBillingSmtpPassword(encryptedPassword: string): string {
  try {
    return decrypt(encryptedPassword);
  } catch (err) {
    if (isCryptoAuthFailure(err)) {
      throw new Error(BILLING_SMTP_CRYPTO_RESAVE_MESSAGE);
    }
    throw err;
  }
}

function billingSmtpFromRow(row: {
  emailSmtpHost: string | null;
  emailSmtpPort: number | null;
  emailSmtpUsername: string | null;
  emailSmtpEncryptedPassword: string | null;
  emailSmtpFromEmail: string | null;
  emailSmtpFromName: string | null;
  emailSmtpTls: boolean;
}): SmtpConnection | null {
  if (!row.emailSmtpHost || !row.emailSmtpUsername || !row.emailSmtpEncryptedPassword) {
    return null;
  }
  if (!canDecrypt(row.emailSmtpEncryptedPassword)) {
    throw new Error(BILLING_SMTP_CRYPTO_RESAVE_MESSAGE);
  }
  const port = row.emailSmtpPort ?? 587;
  return {
    host: row.emailSmtpHost,
    port,
    username: row.emailSmtpUsername,
    password: decryptBillingSmtpPassword(row.emailSmtpEncryptedPassword),
    tls: row.emailSmtpTls,
    from: row.emailSmtpFromEmail?.trim() || row.emailSmtpUsername,
    fromName: row.emailSmtpFromName?.trim() || null,
    source: 'billing',
  };
}

/** SMTP de facturação do workspace, ou fallback tenant/plataforma/env. */
export async function resolveBillingSmtpConnection(
  workspaceId: string,
  tenantId: string
): Promise<{ smtp: SmtpConnection; usingBillingSmtp: boolean }> {
  const row = await getBillingConnection(workspaceId);
  const billingSmtp = row ? billingSmtpFromRow(row) : null;
  if (billingSmtp) {
    return { smtp: billingSmtp, usingBillingSmtp: true };
  }
  const smtp = await resolveSmtpConnection(tenantId);
  return { smtp, usingBillingSmtp: false };
}

export async function resolveBillingEmailBrand(
  workspaceId: string,
  tenantId: string,
  options?: { moloniCompanyName?: string | null }
): Promise<BillingEmailBrand> {
  const row = await getBillingConnection(workspaceId);
  const { appName, smtpFrom } = getServerConfig();

  let supportFallback = smtpFrom || '';
  try {
    const smtp = await resolveSmtpConnection(tenantId);
    supportFallback = smtp.from;
  } catch {
    /* ignore */
  }

  const brandName =
    row?.emailBrandName?.trim() ||
    options?.moloniCompanyName?.trim() ||
    appName;

  const { appNamePrefix, appNameSuffix } = splitAppNameForEmail(brandName);
  const footerText =
    row?.emailFooterText?.trim() ||
    options?.moloniCompanyName?.trim() ||
    brandName;
  const supportEmail = row?.emailSupportEmail?.trim() || supportFallback;
  const fromName = row?.emailSmtpFromName?.trim() || brandName;

  return {
    brandName,
    brandNamePrefix: appNamePrefix,
    brandNameSuffix: appNameSuffix,
    footerText,
    supportEmail,
    fromName,
  };
}

/** Envia email de fatura com template Moloni (não usa templates TVDE do sistema). */
export async function sendBillingInvoiceTemplateEmail(input: {
  workspaceId: string;
  tenantId: string;
  to: string;
  variables: Record<string, string>;
  moloniCompanyName?: string | null;
}) {
  const brand = await resolveBillingEmailBrand(input.workspaceId, input.tenantId, {
    moloniCompanyName: input.moloniCompanyName,
  });
  const { smtp, usingBillingSmtp } = await resolveBillingSmtpConnection(
    input.workspaceId,
    input.tenantId
  );

  const variables: Record<string, string> = {
    ...input.variables,
    appName: brand.footerText,
    appNamePrefix: brand.brandNamePrefix,
    appNameSuffix: brand.brandNameSuffix,
    supportEmail: input.variables.supportEmail || brand.supportEmail,
    footerAddress: input.variables.footerAddress || '',
  };

  const subject = renderEmailTemplate(INVOICE_EMAIL_TEMPLATE.subject, variables);
  const html = renderEmailTemplate(INVOICE_EMAIL_TEMPLATE.htmlBody, variables);

  const bcc = await resolveBillingEmailBcc(input.workspaceId);

  try {
    return await sendEmail({
      tenantId: input.tenantId,
      to: input.to,
      subject,
      html,
      fromName: brand.fromName,
      ...(bcc.length > 0 ? { bcc } : {}),
      // Com SMTP de facturação: não misturar CC/BCC do SMTP do sistema,
      // mas o BCC do workspace (email_bcc) continua a ser passado acima.
      smtpOverride: usingBillingSmtp ? smtp : undefined,
      skipDefaultCopies: usingBillingSmtp,
    });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError && !usingBillingSmtp) {
      throw new EmailNotConfiguredError(
        'SMTP de facturação não configurado — defina em Configurações → Moloni (email de faturas) ou no SMTP do sistema'
      );
    }
    throw err;
  }
}

export async function sendBillingSmtpTestEmail(input: {
  workspaceId: string;
  tenantId: string;
  to: string;
}) {
  const { smtp, usingBillingSmtp } = await resolveBillingSmtpConnection(
    input.workspaceId,
    input.tenantId
  );
  if (!usingBillingSmtp) {
    throw new Error(
      'Configure o SMTP de facturação neste workspace antes de enviar o teste (host, utilizador e password)'
    );
  }
  const brand = await resolveBillingEmailBrand(input.workspaceId, input.tenantId);
  const bcc = await resolveBillingEmailBcc(input.workspaceId);
  const bccNote = bcc.length
    ? `<p>BCC (cópia oculta): <code>${bcc.join(', ')}</code></p>`
    : '<p>BCC: não configurado.</p>';
  return sendEmail({
    tenantId: input.tenantId,
    to: input.to,
    subject: `Teste SMTP facturação — ${brand.brandName}`,
    html: `<p>Este é um email de teste do SMTP de <strong>facturação / Moloni</strong> do workspace.</p>
<p>Remetente: ${brand.fromName}</p>
${bccNote}
<p>Se recebeu esta mensagem, a configuração está correcta.</p>`,
    fromName: brand.fromName,
    ...(bcc.length > 0 ? { bcc } : {}),
    smtpOverride: smtp,
    skipDefaultCopies: true,
  });
}

import { prisma } from '@tvde/database';
import {
  formatAdminMgmtAlertSubject,
  formatAdminMgmtAlertTitle,
  formatAdminMgmtMoney,
  formatWhatsappPhone,
  getAdminMgmtVencimentoOrigemLabel,
  getAdminMgmtVencimentoStatusLabel,
} from '@tvde/shared';
import { EmailNotConfiguredError, resolveSmtpConnection, sendEmail } from './email.service';
import { getWhatsappBridgeStatus, sendWhatsappMessage } from './whatsapp-bridge.client';
import { getAdminMgmtSettings } from './admin-mgmt-settings.service';
import {
  listAdminMgmtVencimentos,
  refreshAdminMgmtVencimentoStatuses,
} from './admin-mgmt-vencimentos.service';

interface AlertSample {
  descricao: string;
  dataVencimento: string;
  origemTipo: string;
  status: string;
  valorAssociado: string | null;
}

function formatDatePt(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function pickAlertSample(workspaceId: string, tenantId: string): Promise<AlertSample> {
  await refreshAdminMgmtVencimentoStatuses(workspaceId, tenantId);
  const rows = await listAdminMgmtVencimentos(workspaceId, tenantId);
  const pending = rows.filter((row) => row.status !== 'resolvido');
  if (pending.length > 0) {
    const row = pending[0];
    return {
      descricao: row.descricao,
      dataVencimento: row.dataVencimento,
      origemTipo: row.origemTipo,
      status: row.status,
      valorAssociado: row.valorAssociado,
    };
  }

  const due = new Date();
  due.setDate(due.getDate() + 7);
  return {
    descricao: 'Seguro Automóvel — 01-AB-23 — renovação',
    dataVencimento: due.toISOString().slice(0, 10),
    origemTipo: 'seguro',
    status: 'pendente',
    valorAssociado: '450.00',
  };
}

function buildAlertContent(sample: AlertSample) {
  const due = formatDatePt(sample.dataVencimento);
  const origem = getAdminMgmtVencimentoOrigemLabel(sample.origemTipo);
  const status = getAdminMgmtVencimentoStatusLabel(sample.status);
  const valor = formatAdminMgmtMoney(sample.valorAssociado);
  const alertTitle = formatAdminMgmtAlertTitle(sample.descricao);
  const subject = formatAdminMgmtAlertSubject(sample.descricao, sample.origemTipo);

  const whatsappBody = [
    `*${subject}*`,
    '',
    `*${alertTitle}*`,
    `Tipo: ${origem}`,
    `Vencimento: ${due}`,
    `Estado: ${status}`,
    ...(valor ? [`Valor: ${valor}`] : []),
    '',
    'Mensagem de teste — o sistema está configurado correctamente.',
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
      <p style="margin:0 0 12px;font-size:13px;color:#64748b">${escapeHtml(alertTitle)}</p>
      <h2 style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:480px">
        <tr><td style="padding:6px 0;color:#64748b">Tipo</td><td style="padding:6px 0">${escapeHtml(origem)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Vencimento</td><td style="padding:6px 0">${escapeHtml(due)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Estado</td><td style="padding:6px 0">${escapeHtml(status)}</td></tr>
        ${valor ? `<tr><td style="padding:6px 0;color:#64748b">Valor</td><td style="padding:6px 0">${escapeHtml(valor)}</td></tr>` : ''}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#64748b">Mensagem de teste — o sistema está configurado correctamente.</p>
    </div>
  `;

  return { subject, html, whatsappBody, alertTitle };
}

export async function getAdminMgmtNotificationStatus(tenantId: string) {
  let emailConfigured = false;
  try {
    await resolveSmtpConnection(tenantId);
    emailConfigured = true;
  } catch {
    emailConfigured = false;
  }

  const whatsapp = await getWhatsappBridgeStatus(tenantId);
  return {
    emailConfigured,
    whatsappConnected: whatsapp.connected,
    whatsappPhone: whatsapp.phoneNumber ?? null,
  };
}

export async function sendAdminMgmtTestNotifications(
  workspaceId: string,
  tenantId: string,
  input: { email?: string; phone?: string }
) {
  const settings = await getAdminMgmtSettings(workspaceId, tenantId);
  const email = input.email?.trim() || settings.alertEmail?.trim() || '';
  const phone = input.phone?.trim() || settings.alertPhone?.trim() || '';

  if (!email && !phone) {
    throw new Error('Configure email ou telefone de destino para o teste');
  }

  const sample = await pickAlertSample(workspaceId, tenantId);
  const content = buildAlertContent(sample);

  const result: {
    email?: { sent: boolean; messageId?: string; error?: string };
    whatsapp?: {
      sent: boolean;
      messageId?: string;
      normalizedTo?: string;
      selfSend?: boolean;
      warning?: string;
      error?: string;
    };
  } = {};

  if (email) {
    try {
      const sent = await sendEmail({
        tenantId,
        to: email,
        subject: content.subject,
        html: content.html,
      });
      result.email = { sent: true, messageId: sent.messageId };
    } catch (err) {
      const message =
        err instanceof EmailNotConfiguredError
          ? 'SMTP não configurado — configure em Definições → SMTP'
          : err instanceof Error
            ? err.message
            : 'Falha ao enviar email';
      result.email = { sent: false, error: message };
    }
  }

  if (phone) {
    const normalizedPhone = formatWhatsappPhone(phone);
    try {
      const status = await getWhatsappBridgeStatus(tenantId);
      if (!status.connected) {
        throw new Error('WhatsApp não ligado — configure em Definições → WhatsApp');
      }
      const sent = await sendWhatsappMessage(tenantId, normalizedPhone || phone, content.whatsappBody);
      result.whatsapp = {
        sent: true,
        messageId: sent.messageId,
        normalizedTo: sent.normalizedTo ?? normalizedPhone,
        selfSend: sent.selfSend,
        warning: sent.warning,
      };
    } catch (err) {
      result.whatsapp = {
        sent: false,
        error: err instanceof Error ? err.message : 'Falha ao enviar WhatsApp',
      };
    }
  }

  const anySent = Boolean(result.email?.sent || result.whatsapp?.sent);
  const allFailed =
    (email ? !result.email?.sent : true) && (phone ? !result.whatsapp?.sent : true) && (email || phone);

  if (allFailed) {
    const errors = [result.email?.error, result.whatsapp?.error].filter(Boolean);
    throw new Error(errors.join(' · ') || 'Falha ao enviar notificações de teste');
  }

  return { ...result, sample, anySent };
}

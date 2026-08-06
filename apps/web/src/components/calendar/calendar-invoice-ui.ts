import type { CalendarEventRecord } from './calendar-types';

export type CalendarInvoiceUiState = {
  status: string;
  emailSent: boolean;
  sendEmail: boolean;
  emailError: string | null;
  autoIssue: boolean;
  completed: boolean;
  failed: boolean;
  pending: boolean;
};

export function getCalendarInvoiceUi(raw?: CalendarEventRecord | null): CalendarInvoiceUiState | null {
  if (!raw || raw.eventType !== 'invoice' || !raw.scheduledInvoice) return null;
  const si = raw.scheduledInvoice;
  const status = si.status;
  return {
    status,
    emailSent: si.emailSent ?? Boolean(si.emailSentAt),
    sendEmail: si.draft?.sendEmail ?? false,
    emailError: si.emailErrorMessage ?? null,
    autoIssue: si.draft?.autoIssue !== false,
    completed: status === 'completed',
    failed: status === 'failed',
    pending: status === 'pending' || status === 'processing',
  };
}

export function appendInvoiceStatusBadge(parent: HTMLElement, invoiceUi: CalendarInvoiceUiState) {
  if (invoiceUi.completed && invoiceUi.emailSent) {
    const badge = document.createElement('span');
    badge.className = 'fc-invoice-badge fc-invoice-badge--email';
    badge.title = 'Email enviado';
    badge.setAttribute('aria-label', 'Email enviado');
    parent.appendChild(badge);
    return;
  }

  if (invoiceUi.completed && invoiceUi.sendEmail && invoiceUi.emailError) {
    const badge = document.createElement('span');
    badge.className = 'fc-invoice-badge fc-invoice-badge--email-failed';
    badge.title = `Email não enviado: ${invoiceUi.emailError}`;
    badge.setAttribute('aria-label', 'Email não enviado');
    parent.appendChild(badge);
    return;
  }

  if (invoiceUi.completed) {
    const badge = document.createElement('span');
    badge.className = 'fc-invoice-badge fc-invoice-badge--done';
    const doneLabel = invoiceUi.autoIssue ? 'Fatura emitida' : 'Rascunho criado';
    badge.title = doneLabel;
    badge.setAttribute('aria-label', doneLabel);
    parent.appendChild(badge);
    return;
  }

  if (invoiceUi.failed) {
    const badge = document.createElement('span');
    badge.className = 'fc-invoice-badge fc-invoice-badge--failed';
    badge.title = 'Falha na autofaturação';
    badge.setAttribute('aria-label', 'Falha na autofaturação');
    parent.appendChild(badge);
  }
}

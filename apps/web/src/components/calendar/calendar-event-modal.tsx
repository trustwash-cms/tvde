'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  buildRecurrenceRule,
  CALENDAR_INVOICE_RECURRENCE_OPTIONS,
  CALENDAR_RECURRENCE_OPTIONS,
  canCreateCalendarScheduledInvoice,
  DEFAULT_CALENDAR_TIMEZONE,
  formatTimezoneLabel,
  isDriverRole,
  isStartInPast,
  minStartDateTimeLocal,
  parseRecurrencePreset,
  type CalendarEventType,
  type CalendarRecurrencePreset,
  type Role,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { GuestContactChips } from '@/components/calendar/guest-contact-chips';
import {
  CalendarInvoiceEventFields,
  emptyInvoiceLine,
  type CalendarInvoiceLineForm,
} from '@/components/calendar/calendar-invoice-event-fields';
import {
  coerceEndAfterStart,
  convertRangeForAllDay,
  defaultEndAfterStart,
  isEndAfterStart,
  parseLocalInput,
  toLocalInputValue,
  buildDefaultEventRange,
} from '@/components/calendar/calendar-datetime';
import { parseLocation } from '@/components/calendar/calendar-location';
import { LocationMapPreview } from '@/components/calendar/location-map-preview';
import {
  CalendarEventAttachments,
  uploadPendingCalendarAttachments,
} from '@/components/calendar/calendar-event-attachments';
import type {
  CalendarEventAttachment,
  CalendarEventRecord,
  CalendarRecord,
  CalendarUser,
} from '@/components/calendar/calendar-types';

function hasInvitees(attendeeIds: string[], guestEmails: string[], guestPhones: string[]) {
  return attendeeIds.length > 0 || guestEmails.length > 0 || guestPhones.length > 0;
}

const REMINDER_OPTIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 1440, label: '1 dia' },
];

interface BillingEntityListItem {
  id: string;
  name: string;
  vat: string | null;
  email: string | null;
  linkStatus?: string;
}

interface ScheduledInvoiceFeatureSettings {
  enabled: boolean;
  billing: { canEnable: boolean };
}

function scheduledInvoiceStatusLabel(status?: string | null, autoIssue?: boolean) {
  const draftOnly = autoIssue === false;
  switch (status) {
    case 'pending':
      // Mesmo status DB (`pending`); o modo distingue intenção até à hora de disparo.
      return draftOnly ? 'Agendado (rascunho)' : 'Pendente';
    case 'processing':
      return draftOnly ? 'A criar rascunho' : 'A processar';
    case 'completed':
      return draftOnly ? 'Rascunho criado' : 'Emitida';
    case 'failed':
      return 'Falhou';
    case 'cancelled':
      return 'Cancelada';
    default:
      return null;
  }
}

function invoiceDateFields(
  start: string,
  end: string,
  allDay: boolean,
  timezone: string
): { allDay: false; start: string; end: string } {
  const needsDatetime = allDay || !start.includes('T');
  const range = buildDefaultEventRange(timezone, false);
  const nextStart = needsDatetime
    ? toLocalInputValue(range.start, false, timezone)
    : start;
  return {
    allDay: false,
    start: nextStart,
    end: coerceEndAfterStart(
      nextStart,
      needsDatetime ? toLocalInputValue(range.end, false, timezone) : end,
      false,
      timezone
    ),
  };
}

/** Suggest +1 month same clock time for a duplicated scheduled invoice. */
function suggestDuplicateInvoiceStart(start: string, timezone: string): string {
  if (!start.includes('T')) {
    const range = buildDefaultEventRange(timezone, false);
    return toLocalInputValue(range.start, false, timezone);
  }
  const instant = parseLocalInput(start, false, timezone);
  const next = new Date(instant);
  const day = next.getDate();
  next.setMonth(next.getMonth() + 1);
  // If month rolled over (e.g. 31 Jan → Mar), clamp to last day of target month
  if (next.getDate() !== day) {
    next.setDate(0);
  }
  // Keep advancing months until the suggested time is in the future
  while (next.getTime() <= Date.now()) {
    const d = next.getDate();
    next.setMonth(next.getMonth() + 1);
    if (next.getDate() !== d) next.setDate(0);
  }
  return toLocalInputValue(next, false, timezone);
}

function titleWithCopySuffix(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '';
  if (/\(cópia\)$/i.test(trimmed)) return trimmed;
  return `${trimmed} (cópia)`;
}

interface CalendarEventModalProps {
  open: boolean;
  onClose: () => void;
  calendars: CalendarRecord[];
  users: CalendarUser[];
  currentUserId: string | null;
  currentUserRole?: Role | null;
  workspaceId: string | null;
  event?: CalendarEventRecord | null;
  initialRange?: { start: Date; end: Date; allDay: boolean } | null;
  onSaved: () => void;
  onDeleted?: () => void;
  panelClassName?: string;
}

export function CalendarEventModal({
  open,
  onClose,
  calendars,
  users,
  currentUserId,
  currentUserRole = null,
  workspaceId,
  event,
  initialRange,
  onSaved,
  onDeleted,
  panelClassName,
}: CalendarEventModalProps) {
  const [duplicateMode, setDuplicateMode] = useState(false);
  const isEdit = Boolean(event) && !duplicateMode;
  const isDriver = currentUserRole != null && isDriverRole(currentUserRole);
  const shareableUsers = useMemo(
    () => (isDriver ? [] : users.filter((u) => u.id !== currentUserId)),
    [users, currentUserId, isDriver]
  );

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [originalStart, setOriginalStart] = useState('');
  const [attachments, setAttachments] = useState<CalendarEventAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    eventType: 'appointment' as CalendarEventType,
    title: '',
    calendarId: '',
    description: '',
    location: '',
    start: '',
    end: '',
    allDay: false,
    recurrencePreset: 'none' as CalendarRecurrencePreset,
    recurrenceUntil: '',
    attendeeIds: [] as string[],
    guestEmails: [] as string[],
    guestPhones: [] as string[],
    reminderMinutes: [15] as number[],
    notifyByEmail: true,
    invoiceBillingEntityId: '',
    invoiceClientEmail: '',
    invoiceYourReference: '',
    invoiceDocumentType: 'invoice',
    invoiceLines: [emptyInvoiceLine()] as CalendarInvoiceLineForm[],
    invoiceAutoIssue: true,
    invoiceSendEmail: true,
  });
  const [invoiceFeature, setInvoiceFeature] = useState<ScheduledInvoiceFeatureSettings | null>(null);
  const [billingEntities, setBillingEntities] = useState<BillingEntityListItem[]>([]);
  const [emailOverride, setEmailOverride] = useState<{
    emailSent: boolean;
    emailSentAt: string | null;
    emailErrorMessage: string | null;
  } | null>(null);

  const selectedCalendar = useMemo(
    () => calendars.find((c) => c.id === form.calendarId) ?? null,
    [calendars, form.calendarId]
  );
  const calendarTimezone = selectedCalendar?.timezone ?? DEFAULT_CALENDAR_TIMEZONE;
  const canUseScheduledInvoice =
    currentUserRole != null && canCreateCalendarScheduledInvoice(currentUserRole);
  const showInvoiceType =
    canUseScheduledInvoice &&
    (Boolean(invoiceFeature?.enabled && invoiceFeature.billing.canEnable) ||
      form.eventType === 'invoice' ||
      event?.eventType === 'invoice');
  const isInvoiceEvent = form.eventType === 'invoice';
  const invoiceProcessed =
    !duplicateMode &&
    ['completed', 'processing'].includes(event?.scheduledInvoice?.status ?? '');

  useEffect(() => {
    if (!open || !workspaceId || !canUseScheduledInvoice) {
      setInvoiceFeature(null);
      setBillingEntities([]);
      return;
    }
    apiFetch<ScheduledInvoiceFeatureSettings>(
      withWorkspaceQuery(API_PATHS.calendar.scheduledInvoiceSettings, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setInvoiceFeature(res.data);
    });
    apiFetch<BillingEntityListItem[]>(
      withWorkspaceQuery(API_PATHS.billing.entities, workspaceId, {
        entityType: 'customer',
        status: 'active',
      }),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setBillingEntities(res.data);
    });
  }, [open, workspaceId, canUseScheduledInvoice]);

  useEffect(() => {
    if (!open) return;
    setEmailOverride(null);
    setDuplicateMode(false);

    if (event) {
      const eventTimezone =
        event.timezone ??
        calendars.find((c) => c.id === event.calendarId)?.timezone ??
        DEFAULT_CALENDAR_TIMEZONE;
      const attendeeIds = event.attendees
        .filter((a) => a.role !== 'organizer')
        .map((a) => a.userId);
      const guestEmails = event.guestEmails ?? [];
      const guestPhones = event.guestPhones ?? [];
      const draft = event.scheduledInvoice?.draft;
      const allDay = event.eventType === 'invoice' ? false : event.allDay;
      let start = toLocalInputValue(new Date(event.startAt), allDay, eventTimezone);
      let end = toLocalInputValue(new Date(event.endAt), allDay, eventTimezone);
      if (event.eventType === 'invoice') {
        const dates = invoiceDateFields(start, end, event.allDay || !start.includes('T'), eventTimezone);
        start = dates.start;
        end = dates.end;
      }
      setOriginalStart(start);
      setAttachments(event.attachments ?? []);
      setPendingFiles([]);
      setForm({
        eventType: event.eventType ?? 'appointment',
        title: event.title,
        calendarId: event.calendarId,
        description: event.description ?? '',
        location: event.location ?? '',
        start,
        end,
        allDay,
        recurrencePreset: parseRecurrencePreset(event.recurrenceRule),
        recurrenceUntil: event.recurrenceUntil
          ? toLocalInputValue(new Date(event.recurrenceUntil), true, eventTimezone)
          : '',
        attendeeIds,
        guestEmails,
        guestPhones,
        reminderMinutes: event.reminders.length
          ? Array.from(new Set(event.reminders.map((r) => r.offsetMinutes)))
          : [15],
        notifyByEmail: hasInvitees(attendeeIds, guestEmails, guestPhones),
        invoiceBillingEntityId: draft?.billingEntityId ?? event.scheduledInvoice?.billingEntityId ?? '',
        invoiceClientEmail: draft?.clientEmail ?? event.scheduledInvoice?.billingEntity?.email ?? '',
        invoiceYourReference: draft?.yourReference ?? '',
        invoiceDocumentType: draft?.documentType ?? 'invoice',
        invoiceLines: draft?.lines?.length ? draft.lines : [emptyInvoiceLine()],
        invoiceAutoIssue: draft?.autoIssue ?? true,
        invoiceSendEmail: draft?.sendEmail ?? true,
      });
    } else if (initialRange) {
      const defaultCal = calendars.find((c) => c.isDefault) ?? calendars[0];
      const tz = defaultCal?.timezone ?? DEFAULT_CALENDAR_TIMEZONE;
      const start = toLocalInputValue(initialRange.start, initialRange.allDay, tz);
      setOriginalStart('');
      setAttachments([]);
      setPendingFiles([]);
      setForm({
        eventType: 'appointment',
        title: '',
        calendarId: defaultCal?.id ?? '',
        description: '',
        location: '',
        start,
        end: coerceEndAfterStart(
          start,
          toLocalInputValue(initialRange.end, initialRange.allDay, tz),
          initialRange.allDay,
          tz
        ),
        allDay: initialRange.allDay,
        recurrencePreset: 'none',
        recurrenceUntil: '',
        attendeeIds: [],
        guestEmails: [],
        guestPhones: [],
        reminderMinutes: [15],
        notifyByEmail: true,
        invoiceBillingEntityId: '',
        invoiceClientEmail: '',
        invoiceYourReference: '',
        invoiceDocumentType: 'invoice',
        invoiceLines: [emptyInvoiceLine()],
        invoiceAutoIssue: true,
        invoiceSendEmail: true,
      });
    }
    setError('');
  }, [open, event, initialRange, calendars]);

  function toggleAttendee(userId: string) {
    setForm((f) => {
      const attendeeIds = f.attendeeIds.includes(userId)
        ? f.attendeeIds.filter((id) => id !== userId)
        : [...f.attendeeIds, userId];
      return {
        ...f,
        attendeeIds,
        notifyByEmail: hasInvitees(attendeeIds, f.guestEmails, f.guestPhones) ? f.notifyByEmail : false,
      };
    });
  }

  function setGuestContacts(guestEmails: string[], guestPhones: string[]) {
    setForm((f) => ({
      ...f,
      guestEmails,
      guestPhones,
      notifyByEmail: hasInvitees(f.attendeeIds, guestEmails, guestPhones) ? f.notifyByEmail : false,
    }));
  }

  function addUserEmailAsGuest(email: string) {
    const normalized = email.toLowerCase();
    setGuestContacts(
      form.guestEmails.includes(normalized) ? form.guestEmails : [...form.guestEmails, normalized],
      form.guestPhones
    );
  }

  function handleCalendarChange(calendarId: string) {
    setForm((f) => {
      const prevCal = calendars.find((c) => c.id === f.calendarId);
      const nextCal = calendars.find((c) => c.id === calendarId);
      const prevTz = prevCal?.timezone ?? DEFAULT_CALENDAR_TIMEZONE;
      const nextTz = nextCal?.timezone ?? DEFAULT_CALENDAR_TIMEZONE;
      if (!f.start || prevTz === nextTz) {
        return { ...f, calendarId };
      }
      const startInstant = parseLocalInput(f.start, f.allDay, prevTz);
      const endInstant = parseLocalInput(f.end, f.allDay, prevTz);
      const start = toLocalInputValue(startInstant, f.allDay, nextTz);
      return {
        ...f,
        calendarId,
        start,
        end: coerceEndAfterStart(
          start,
          toLocalInputValue(endInstant, f.allDay, nextTz),
          f.allDay,
          nextTz
        ),
      };
    });
  }

  function handleStartChange(start: string) {
    setForm((f) => ({
      ...f,
      start,
      // Sempre alinhado a +30 min (ou dia seguinte se dia inteiro); o utilizador pode ajustar o fim depois.
      end: start ? defaultEndAfterStart(start, f.allDay, calendarTimezone) : f.end,
    }));
  }

  function handleEndChange(end: string) {
    setForm((f) => {
      if (f.start && !isEndAfterStart(f.start, end, f.allDay, calendarTimezone)) {
        return f;
      }
      return { ...f, end };
    });
  }

  function handleAllDayChange(allDay: boolean) {
    setForm((f) => {
      const { start, end } = convertRangeForAllDay(f.start, f.end, allDay, calendarTimezone);
      return { ...f, allDay, start, end };
    });
  }

  function toggleReminder(minutes: number) {
    setForm((f) => ({
      ...f,
      reminderMinutes: f.reminderMinutes.includes(minutes)
        ? f.reminderMinutes.filter((m) => m !== minutes)
        : [...f.reminderMinutes, minutes].sort((a, b) => a - b),
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) {
      setError('Workspace não seleccionado');
      return;
    }
    if (!isEndAfterStart(form.start, form.end, form.allDay, calendarTimezone)) {
      setError('A data de fim deve ser posterior à data de início');
      return;
    }
    const isInvoice = form.eventType === 'invoice';
    const startChanged = isEdit && form.start !== originalStart;
    if (!isEdit || startChanged) {
      if (isStartInPast(form.start, calendarTimezone, isInvoice ? false : form.allDay)) {
        setError(
          !isInvoice && form.allDay
            ? 'A data de início não pode ser no passado'
            : 'A data de início não pode ser anterior à hora actual'
        );
        return;
      }
    }
    setLoading(true);
    setError('');

    const startAt = parseLocalInput(form.start, isInvoice ? false : form.allDay, calendarTimezone);
    const endAt = isInvoice
      ? new Date(startAt.getTime() + 30 * 60 * 1000)
      : parseLocalInput(form.end, form.allDay, calendarTimezone);
    const invitees = hasInvitees(form.attendeeIds, form.guestEmails, form.guestPhones);

    if (isInvoice) {
      if (!form.invoiceBillingEntityId) {
        setLoading(false);
        setError('Seleccione o cliente para facturação');
        return;
      }
      if (!form.invoiceClientEmail.trim()) {
        setLoading(false);
        setError('Indique o email de notificação do cliente');
        return;
      }
      const validLines = form.invoiceLines.filter((line) => line.description.trim());
      if (validLines.length === 0) {
        setLoading(false);
        setError('Adicione pelo menos uma linha à fatura');
        return;
      }
      const missingRef = validLines.find(
        (line) => !line.moloniProductId && !line.productReference?.trim()
      );
      if (missingRef) {
        setLoading(false);
        setError(
          `Linha «${missingRef.description.slice(0, 40)}» — indique a Ref.ª Artigo ou seleccione um artigo existente`
        );
        return;
      }
    }

    const effectivePreset: CalendarRecurrencePreset = isInvoice
      ? form.recurrencePreset === 'monthly'
        ? 'monthly'
        : 'none'
      : form.recurrencePreset;
    const recurrenceRule = buildRecurrenceRule(effectivePreset);
    const recurrenceUntil =
      effectivePreset !== 'none' && form.recurrenceUntil
        ? parseLocalInput(`${form.recurrenceUntil}T23:59`, false, calendarTimezone).toISOString()
        : effectivePreset === 'none'
          ? null
          : undefined;

    const selectedEntity = billingEntities.find((e) => e.id === form.invoiceBillingEntityId);
    const title =
      form.title.trim() ||
      (isInvoice && selectedEntity ? `Fatura — ${selectedEntity.name}` : form.title);

    const payload: Record<string, unknown> = {
      workspaceId,
      calendarId: form.calendarId,
      title,
      description: form.description || undefined,
      location: isInvoice ? undefined : form.location || undefined,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      allDay: isInvoice ? false : form.allDay,
      timezone: calendarTimezone,
      eventType: form.eventType,
      attendees: isInvoice ? [] : form.attendeeIds.map((userId) => ({ userId, canEdit: false })),
      guestEmails: isInvoice ? [] : form.guestEmails,
      guestPhones: isInvoice ? [] : form.guestPhones,
      reminders: isInvoice ? [] : form.reminderMinutes.map((offsetMinutes) => ({ offsetMinutes })),
      notifyAttendeesByEmail: !isInvoice && invitees && form.notifyByEmail,
    };

    if (isInvoice) {
      payload.scheduledInvoice = {
        billingEntityId: form.invoiceBillingEntityId,
        clientEmail: form.invoiceClientEmail.trim(),
        lines: form.invoiceLines
          .filter((line) => line.description.trim())
          .map((line) => ({
            description: line.description.trim(),
            summary: line.summary?.trim() || undefined,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            moloniProductId: line.moloniProductId,
            productReference: line.productReference?.trim() || undefined,
            moloniTaxId: line.moloniTaxId,
            moloniExemptionReason:
              (line.vatRate ?? 23) === 0 ? line.moloniExemptionReason ?? 'M07' : undefined,
          })),
        documentType: form.invoiceDocumentType || 'invoice',
        yourReference: form.invoiceYourReference.trim() || undefined,
        autoIssue: form.invoiceAutoIssue,
        sendEmail: form.invoiceSendEmail,
        notes: form.description || undefined,
      };
    }

    if (isEdit || recurrenceRule) {
      payload.recurrenceRule = recurrenceRule;
    }
    if (isEdit || recurrenceUntil) {
      payload.recurrenceUntil = recurrenceUntil;
    }

    const token = getStoredToken();
    const eventId = isEdit ? event!.seriesMasterId ?? event!.id : '';
    const res = isEdit
      ? await apiFetch(API_PATHS.calendar.eventById(eventId), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }, token)
      : await apiFetch(API_PATHS.calendar.events, {
          method: 'POST',
          body: JSON.stringify(payload),
        }, token);

    if (res.success) {
      const savedEventId = isEdit ? event!.seriesMasterId ?? event!.id : (res.data as CalendarEventRecord | undefined)?.id;
      const notifyWarnings: string[] = [];
      const emailN = (res as {
        emailNotifications?: { sent?: number; errors?: string[] };
      }).emailNotifications;
      const waN = (res as {
        whatsappNotifications?: { sent?: number; errors?: string[] };
      }).whatsappNotifications;
      if (emailN?.errors?.length) notifyWarnings.push(...emailN.errors);
      if (waN?.errors?.length) notifyWarnings.push(...waN.errors);
      if (
        !isInvoice &&
        invitees &&
        form.notifyByEmail &&
        waN &&
        (waN.sent ?? 0) === 0 &&
        !waN.errors?.length
      ) {
        notifyWarnings.push(
          'WhatsApp: nenhuma mensagem enviada (verifique Config → Calendário → WhatsApp e ligação em Config → WhatsApp)'
        );
      }
      if (savedEventId && pendingFiles.length > 0) {
        const uploadErrors = await uploadPendingCalendarAttachments(savedEventId, pendingFiles);
        if (uploadErrors.length > 0) {
          setLoading(false);
          setError(
            `Evento guardado, mas alguns anexos falharam: ${uploadErrors.join('; ')}${
              notifyWarnings.length ? ` · ${notifyWarnings.join(' · ')}` : ''
            }`
          );
          onSaved();
          return;
        }
      }
      setLoading(false);
      if (notifyWarnings.length > 0) {
        setError(`Evento guardado, mas: ${notifyWarnings.join(' · ')}`);
        onSaved();
        return;
      }
      onSaved();
      onClose();
    } else {
      setLoading(false);
      setError(getApiErrorMessage(res));
    }
  }

  async function handleDelete() {
    if (!event || duplicateMode) return;
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.calendar.eventById(event.seriesMasterId ?? event.id),
      { method: 'DELETE' },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      onDeleted?.();
      onSaved();
      onClose();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  function handleDuplicateInvoice() {
    if (!isInvoiceEvent || !event) return;
    const nextStart = suggestDuplicateInvoiceStart(form.start, calendarTimezone);
    const nextEnd = coerceEndAfterStart(nextStart, form.end, false, calendarTimezone);
    setDuplicateMode(true);
    setOriginalStart('');
    setAttachments([]);
    setPendingFiles([]);
    setEmailOverride(null);
    setError('');
    setForm((f) => ({
      ...f,
      eventType: 'invoice',
      title: titleWithCopySuffix(f.title),
      start: nextStart,
      end: nextEnd,
      allDay: false,
      recurrencePreset: 'none',
      recurrenceUntil: '',
      invoiceLines: f.invoiceLines.map((line) => ({ ...line })),
    }));
  }

  const showNotify = hasInvitees(form.attendeeIds, form.guestEmails, form.guestPhones);
  const attachmentEventId = isEdit ? event?.seriesMasterId ?? event?.id ?? null : null;
  const parsedLocation = parseLocation(form.location);
  const startMin = minStartDateTimeLocal(calendarTimezone, isInvoiceEvent ? false : form.allDay);
  const endMin = form.start
    ? form.allDay
      ? defaultEndAfterStart(form.start, true, calendarTimezone)
      : form.start
    : undefined;

  const actionFooter = (
    <div className="flex flex-wrap justify-between gap-2">
      {isEdit ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-danger"
            onClick={handleDelete}
            disabled={loading}
          >
            Eliminar
          </button>
          {isInvoiceEvent && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleDuplicateInvoice}
              disabled={loading}
              title="Cria um novo evento com os mesmos dados (sem anexos nem fatura emitida)"
            >
              Duplicar
            </button>
          )}
        </div>
      ) : (
        <span />
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
          Cancelar
        </button>
        <button type="submit" form="calendar-event-form" className="btn-primary" disabled={loading}>
          {loading ? 'A guardar…' : isEdit ? 'Guardar' : 'Criar evento'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        duplicateMode
          ? 'Nova fatura agendada (cópia)'
          : isEdit
            ? isInvoiceEvent
              ? 'Editar fatura agendada'
              : 'Editar evento'
            : isInvoiceEvent
              ? 'Nova fatura agendada'
              : 'Novo evento'
      }
      panelClassName={panelClassName ? `${panelClassName} max-w-lg` : 'max-w-lg'}
      scrollBody
      footer={actionFooter}
    >
      <form id="calendar-event-form" onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {duplicateMode && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Cópia nova — ajuste a data e guarde. O evento original e a fatura Moloni não são alterados.
            Recorrência desligada; anexos anteriores não são copiados.
          </div>
        )}
        {showInvoiceType && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de evento</label>
            <select
              className="input"
              value={form.eventType}
              disabled={invoiceProcessed}
              onChange={(e) => {
                const nextType = e.target.value as CalendarEventType;
                if (nextType === 'invoice') {
                  const dates = invoiceDateFields(
                    form.start,
                    form.end,
                    form.allDay,
                    calendarTimezone
                  );
                  setForm({
                    ...form,
                    eventType: nextType,
                    recurrencePreset: 'none',
                    recurrenceUntil: '',
                    ...dates,
                  });
                } else {
                  setForm({
                    ...form,
                    eventType: nextType,
                    recurrencePreset: 'none',
                    recurrenceUntil: '',
                  });
                }
              }}
            >
              <option value="appointment">Compromisso</option>
              <option value="invoice">Fatura agendada</option>
            </select>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Título</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required={!isInvoiceEvent}
              maxLength={200}
              placeholder={isInvoiceEvent ? 'Opcional — preenchido com o nome do cliente' : undefined}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Calendário</label>
            <select
              className="input"
              value={form.calendarId}
              onChange={(e) => handleCalendarChange(e.target.value)}
              required
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {!isInvoiceEvent && (
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => handleAllDayChange(e.target.checked)}
              />
              Dia inteiro
            </label>
          )}

          <div className={isInvoiceEvent ? 'sm:col-span-2' : undefined}>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {isInvoiceEvent ? 'Data / hora de emissão' : 'Início'}
            </label>
            <input
              className="input"
              type={isInvoiceEvent || !form.allDay ? 'datetime-local' : 'date'}
              value={form.start}
              min={startMin}
              onChange={(e) => handleStartChange(e.target.value)}
              required
            />
            {isInvoiceEvent && (
              <p className="mt-1 text-[11px] text-slate-500">
                A fatura será emitida automaticamente nesta data e hora.
              </p>
            )}
          </div>
          {!isInvoiceEvent && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Fim</label>
              <input
                className="input"
                type={form.allDay ? 'date' : 'datetime-local'}
                value={form.end}
                min={endMin}
                onChange={(e) => handleEndChange(e.target.value)}
                required
              />
            </div>
          )}
          <p className="sm:col-span-2 text-xs text-slate-500">
            Fuso horário: {formatTimezoneLabel(calendarTimezone)}
          </p>

          {isInvoiceEvent ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Repetir mensalmente
                </label>
                <select
                  className="input"
                  value={
                    form.recurrencePreset === 'monthly' ? 'monthly' : 'none'
                  }
                  disabled={invoiceProcessed}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      recurrencePreset: e.target.value as CalendarRecurrencePreset,
                      recurrenceUntil: e.target.value === 'none' ? '' : form.recurrenceUntil,
                    })
                  }
                >
                  {CALENDAR_INVOICE_RECURRENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Avença: após cada emissão (ou rascunho), agenda a próxima no mesmo dia do mês.
                </p>
              </div>

              {form.recurrencePreset === 'monthly' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Repetir até (opcional)
                  </label>
                  <input
                    className="input"
                    type="date"
                    value={form.recurrenceUntil}
                    min={form.start ? form.start.slice(0, 10) : undefined}
                    disabled={invoiceProcessed}
                    onChange={(e) => setForm({ ...form, recurrenceUntil: e.target.value })}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Repetir</label>
                <select
                  className="input"
                  value={form.recurrencePreset}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      recurrencePreset: e.target.value as CalendarRecurrencePreset,
                      recurrenceUntil: e.target.value === 'none' ? '' : form.recurrenceUntil,
                    })
                  }
                >
                  {CALENDAR_RECURRENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {form.recurrencePreset !== 'none' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Repetir até (opcional)
                  </label>
                  <input
                    className="input"
                    type="date"
                    value={form.recurrenceUntil}
                    min={form.start ? form.start.slice(0, 10) : undefined}
                    onChange={(e) => setForm({ ...form, recurrenceUntil: e.target.value })}
                  />
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Morada</label>
                <input
                  className="input"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Rua, cidade · 41.15, -8.61 · https://meet.google.com/..."
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Morada, coordenadas (lat, lng) ou link de videochamada
                </p>
                {parsedLocation.kind === 'url' && parsedLocation.mapsUrl && (
                  <a
                    href={parsedLocation.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs font-medium text-[var(--color-primary)] hover:underline"
                  >
                    Abrir videochamada
                  </a>
                )}
                {parsedLocation.kind !== 'url' && (
                  <LocationMapPreview location={form.location} />
                )}
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Descrição</label>
            <textarea
              className="input min-h-[56px]"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>

        {isInvoiceEvent && (
          <CalendarInvoiceEventFields
            workspaceId={workspaceId}
            entities={billingEntities}
            billingEntityId={form.invoiceBillingEntityId}
            onBillingEntityChange={(id) => {
              const entity = billingEntities.find((e) => e.id === id);
              setForm((f) => ({
                ...f,
                invoiceBillingEntityId: id,
                invoiceClientEmail: entity?.email?.trim() || f.invoiceClientEmail,
              }));
            }}
            clientEmail={form.invoiceClientEmail}
            onClientEmailChange={(invoiceClientEmail) => setForm((f) => ({ ...f, invoiceClientEmail }))}
            yourReference={form.invoiceYourReference}
            onYourReferenceChange={(invoiceYourReference) =>
              setForm((f) => ({ ...f, invoiceYourReference }))
            }
            lines={form.invoiceLines}
            onLinesChange={(invoiceLines) => setForm((f) => ({ ...f, invoiceLines }))}
            autoIssue={form.invoiceAutoIssue}
            onAutoIssueChange={(invoiceAutoIssue) =>
              setForm((f) => ({
                ...f,
                invoiceAutoIssue,
                invoiceSendEmail: invoiceAutoIssue ? f.invoiceSendEmail : false,
              }))
            }
            sendEmail={form.invoiceSendEmail}
            onSendEmailChange={(invoiceSendEmail) => setForm((f) => ({ ...f, invoiceSendEmail }))}
            readOnly={invoiceProcessed}
            statusLabel={
              duplicateMode
                ? 'Nova (cópia)'
                : scheduledInvoiceStatusLabel(
                    event?.scheduledInvoice?.status,
                    form.invoiceAutoIssue
                  )
            }
            errorMessage={duplicateMode ? null : (event?.scheduledInvoice?.errorMessage ?? null)}
            emailSent={
              duplicateMode
                ? false
                : (emailOverride?.emailSent ?? event?.scheduledInvoice?.emailSent)
            }
            emailSentAt={
              duplicateMode
                ? null
                : (emailOverride?.emailSentAt ?? event?.scheduledInvoice?.emailSentAt ?? null)
            }
            emailErrorMessage={
              duplicateMode
                ? null
                : emailOverride
                  ? emailOverride.emailErrorMessage
                  : (event?.scheduledInvoice?.emailErrorMessage ?? null)
            }
            scheduledInvoiceId={duplicateMode ? null : (event?.scheduledInvoice?.id ?? null)}
            onEmailResent={({ emailSentAt }) => {
              setEmailOverride({
                emailSent: true,
                emailSentAt,
                emailErrorMessage: null,
              });
              setError('');
              onSaved();
            }}
          />
        )}

        {!isInvoiceEvent && (
          <>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Convidados</label>
          <GuestContactChips
            emails={form.guestEmails}
            phones={form.guestPhones}
            onChange={({ emails, phones }) => setGuestContacts(emails, phones)}
            placeholder="Email ou telefone do convidado"
          />
          {shareableUsers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {shareableUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                  onClick={() => addUserEmailAsGuest(u.email)}
                  disabled={form.guestEmails.includes(u.email.toLowerCase())}
                >
                  + {u.email}
                </button>
              ))}
            </div>
          )}
        </div>

        {shareableUsers.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Acesso no sistema (utilizadores do tenant)
            </label>
            <div className="max-h-20 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {shareableUsers.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.attendeeIds.includes(u.id)}
                    onChange={() => toggleAttendee(u.id)}
                  />
                  <span className="truncate">{u.email}</span>
                  <span className="text-[10px] uppercase text-slate-400">{u.role}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {showNotify && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.notifyByEmail}
              onChange={(e) => setForm({ ...form, notifyByEmail: e.target.checked })}
            />
            Enviar notificação aos convidados (email e WhatsApp, se activos)
          </label>
        )}
          </>
        )}

        <CalendarEventAttachments
          eventId={attachmentEventId}
          attachments={attachments}
          pendingFiles={pendingFiles}
          onAttachmentsChange={setAttachments}
          onPendingFilesChange={setPendingFiles}
          disabled={loading}
        />

        {!isInvoiceEvent && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Lembretes</label>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_OPTIONS.map((opt) => (
              <button
                key={opt.minutes}
                type="button"
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  form.reminderMinutes.includes(opt.minutes)
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                onClick={() => toggleReminder(opt.minutes)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        )}

      </form>
    </Modal>
  );
}

import { prisma } from '@tvde/database';
import { CALENDAR_APPOINTMENT_TEMPLATE } from '../calendar-appointment-email-template';
import { EmailNotConfiguredError, EMAIL_TEMPLATE_KEYS, sendEmail } from '../email.service';
import { getWhatsappBridgeStatus, sendWhatsappMessage } from '../whatsapp-bridge.client';
import { readGuestEmails, readGuestPhones } from './calendar-guest-emails';
import {
  buildLocationMapEmailAssets,
  formatLocationForEmail,
} from './calendar-location-format';

const TEMPLATE_MODE_KEY = 'calendar_appointment_template_mode';
const WHATSAPP_ENABLED_KEY = 'calendar_appointment_whatsapp_enabled';
const TEMPLATE_KEY = EMAIL_TEMPLATE_KEYS.calendarAppointment;

const PT_DATE = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const PT_MONTH = new Intl.DateTimeFormat('pt-PT', { month: 'long' });

function formatEventDate(date: Date, allDay: boolean): string {
  if (allDay) {
    return new Intl.DateTimeFormat('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }
  return PT_DATE.format(date);
}

export async function getCalendarEmailTemplateSettings(tenantId: string) {
  const modeRow = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: TEMPLATE_MODE_KEY } },
  });
  const useCustom = modeRow?.value === 'custom';

  const custom = await prisma.emailTemplate.findUnique({
    where: { tenantId_key: { tenantId, key: TEMPLATE_KEY } },
  });

  return {
    mode: useCustom ? ('custom' as const) : ('default' as const),
    variables: [...CALENDAR_APPOINTMENT_TEMPLATE.variables],
    subject: useCustom && custom ? custom.subject : CALENDAR_APPOINTMENT_TEMPLATE.subject,
    htmlBody: useCustom && custom ? custom.htmlBody : undefined,
  };
}

export async function saveCalendarEmailTemplateSettings(
  tenantId: string,
  input: { mode: 'default' | 'custom'; subject?: string; htmlBody?: string }
) {
  if (input.mode === 'default') {
    await prisma.$transaction([
      prisma.emailTemplate.deleteMany({
        where: { tenantId, key: TEMPLATE_KEY },
      }),
      prisma.tenantSetting.upsert({
        where: { tenantId_key: { tenantId, key: TEMPLATE_MODE_KEY } },
        create: { tenantId, key: TEMPLATE_MODE_KEY, value: 'default' },
        update: { value: 'default' },
      }),
    ]);
    return getCalendarEmailTemplateSettings(tenantId);
  }

  if (!input.subject?.trim() || !input.htmlBody?.trim()) {
    throw new Error('Assunto e HTML são obrigatórios no modo personalizado');
  }

  await prisma.$transaction([
    prisma.emailTemplate.upsert({
      where: { tenantId_key: { tenantId, key: TEMPLATE_KEY } },
      create: {
        tenantId,
        key: TEMPLATE_KEY,
        subject: input.subject,
        htmlBody: input.htmlBody,
        variables: [...CALENDAR_APPOINTMENT_TEMPLATE.variables],
      },
      update: {
        subject: input.subject,
        htmlBody: input.htmlBody,
      },
    }),
    prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: TEMPLATE_MODE_KEY } },
      create: { tenantId, key: TEMPLATE_MODE_KEY, value: 'custom' },
      update: { value: 'custom' },
    }),
  ]);

  return getCalendarEmailTemplateSettings(tenantId);
}

async function resolveTemplateForTenant(tenantId: string) {
  const settings = await getCalendarEmailTemplateSettings(tenantId);
  if (settings.mode === 'custom' && settings.htmlBody) {
    return {
      subject: settings.subject,
      htmlBody: settings.htmlBody,
    };
  }
  return {
    subject: CALENDAR_APPOINTMENT_TEMPLATE.subject,
    htmlBody: CALENDAR_APPOINTMENT_TEMPLATE.htmlBody,
  };
}

function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? '');
}

async function buildEventEmailVariables(eventId: string): Promise<{
  variables: Record<string, string>;
  mapAttachment: { filename: string; content: Buffer; cid: string } | null;
} | null> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    include: {
      tenant: { select: { name: true } },
      attendees: {
        where: { role: { not: 'organizer' } },
        include: { user: { select: { email: true } } },
      },
    },
  });

  if (!event) return null;

  const guestEmails = readGuestEmails(event.metadataJson);
  const guestPhones = readGuestPhones(event.metadataJson);
  const inviteeEmails = [
    ...event.attendees.map((a) => a.user.email),
    ...guestEmails,
  ];
  const inviteeLabels = [
    ...inviteeEmails,
    ...guestPhones,
  ];
  const guests = inviteeLabels.length > 0 ? inviteeLabels.join(', ') : '—';

  const mapAssets = await buildLocationMapEmailAssets(event.location);

  return {
    variables: {
      eventTitle: event.title,
      eventSummary:
        event.description?.trim() ||
        'O seu compromisso foi agendado. Consulte os detalhes abaixo.',
      monthAbbr: PT_MONTH.format(event.startAt),
      day: String(event.startAt.getDate()),
      startAt: formatEventDate(event.startAt, event.allDay),
      endAt: formatEventDate(event.endAt, event.allDay),
      location: formatLocationForEmail(event.location),
      locationMap: mapAssets.locationMap,
      guests,
      year: String(new Date().getFullYear()),
      companyName: event.tenant.name,
      companyAddress: '',
    },
    mapAttachment: mapAssets.mapAttachment,
  };
}

export async function sendCalendarAppointmentEmails(
  tenantId: string,
  eventId: string
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    include: {
      attendees: {
        where: { role: { not: 'organizer' }, notify: true },
        include: { user: { select: { id: true, email: true } } },
      },
    },
  });

  if (!event) {
    return { sent: 0, skipped: 0, errors: [] };
  }

  const guestEmails = readGuestEmails(event.metadataJson);
  const recipientEmails = [
    ...new Set([
      ...event.attendees.map((a) => a.user.email.toLowerCase()),
      ...guestEmails,
    ]),
  ];

  if (recipientEmails.length === 0) {
    return { sent: 0, skipped: 0, errors: [] };
  }

  const emailData = await buildEventEmailVariables(eventId);
  if (!emailData) {
    return { sent: 0, skipped: recipientEmails.length, errors: ['Evento não encontrado'] };
  }

  const template = await resolveTemplateForTenant(tenantId);
  const subject = renderTemplate(template.subject, emailData.variables);
  const html = renderTemplate(template.htmlBody, emailData.variables);
  const attachments = emailData.mapAttachment ? [emailData.mapAttachment] : undefined;

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const email of recipientEmails) {
    try {
      await sendEmail({
        tenantId,
        to: email,
        subject,
        html,
        attachments,
      });
      sent += 1;
    } catch (err) {
      if (err instanceof EmailNotConfiguredError) {
        skipped = recipientEmails.length;
        errors.push('SMTP não configurado — notificações por email não enviadas');
        break;
      }
      errors.push(
        err instanceof Error ? `Falha para ${email}: ${err.message}` : 'Erro ao enviar'
      );
      skipped += 1;
    }
  }

  return { sent, skipped, errors };
}

export async function resolveCalendarWhatsappAvailability(
  tenantId: string,
  workspaceId: string
) {
  const [tenantModule, workspaceModule, bridge] = await Promise.all([
    prisma.tenantModule.findFirst({
      where: { tenantId, moduleKey: 'whatsapp', allowed: true },
    }),
    prisma.workspaceModule.findFirst({
      where: { workspaceId, moduleKey: 'whatsapp', enabled: true },
    }),
    getWhatsappBridgeStatus(tenantId),
  ]);

  const moduleActive = Boolean(tenantModule && workspaceModule);
  const connected = bridge.connected && bridge.state === 'ready';

  return {
    moduleActive,
    connected,
    state: bridge.state,
    phoneNumber: bridge.phoneNumber ?? null,
    canEnable: moduleActive && connected,
  };
}

export async function isCalendarWhatsappEnabled(tenantId: string, workspaceId: string) {
  const availability = await resolveCalendarWhatsappAvailability(tenantId, workspaceId);
  if (!availability.canEnable) return false;

  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: WHATSAPP_ENABLED_KEY } },
  });
  return row?.value === 'true';
}

export async function getCalendarWhatsappSettings(tenantId: string, workspaceId: string) {
  const whatsapp = await resolveCalendarWhatsappAvailability(tenantId, workspaceId);
  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: WHATSAPP_ENABLED_KEY } },
  });

  return {
    enabled: row?.value === 'true',
    whatsapp,
  };
}

export async function saveCalendarWhatsappSettings(
  tenantId: string,
  workspaceId: string,
  enabled: boolean
) {
  if (enabled) {
    const availability = await resolveCalendarWhatsappAvailability(tenantId, workspaceId);
    if (!availability.moduleActive) {
      throw new Error('Módulo WhatsApp não está activo neste workspace');
    }
    if (!availability.connected) {
      throw new Error('WhatsApp não está ligado — configure em Configurações → WhatsApp');
    }
  }

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key: WHATSAPP_ENABLED_KEY } },
    create: { tenantId, key: WHATSAPP_ENABLED_KEY, value: enabled ? 'true' : 'false' },
    update: { value: enabled ? 'true' : 'false' },
  });

  return getCalendarWhatsappSettings(tenantId, workspaceId);
}

function formatEventWhatsappMessage(input: {
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
  companyName: string;
}): string {
  const lines = [
    `*Compromisso agendado*`,
    '',
    `*${input.title}*`,
    `Quando: ${formatEventDate(input.startAt, input.allDay)} → ${formatEventDate(input.endAt, input.allDay)}`,
  ];
  if (input.location?.trim()) {
    lines.push(`Local: ${input.location.trim()}`);
  }
  lines.push('', input.companyName);
  return lines.join('\n');
}

export async function sendCalendarAppointmentWhatsApp(
  tenantId: string,
  workspaceId: string,
  eventId: string
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const enabled = await isCalendarWhatsappEnabled(tenantId, workspaceId);
  if (!enabled) {
    return { sent: 0, skipped: 0, errors: [] };
  }

  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    include: {
      tenant: { select: { name: true } },
      attendees: {
        where: { role: { not: 'organizer' }, notify: true },
        include: { user: { select: { id: true, phone: true, email: true } } },
      },
    },
  });

  if (!event) {
    return { sent: 0, skipped: 0, errors: [] };
  }

  const guestEmails = readGuestEmails(event.metadataJson);
  const guestPhones = readGuestPhones(event.metadataJson);

  const phones = [
    ...new Set(
      [
        ...event.attendees
          .map((a) => a.user.phone?.trim())
          .filter((phone): phone is string => Boolean(phone)),
        ...guestPhones,
      ].map((phone) => phone.replace(/\s+/g, ' ').trim())
    ),
  ];

  if (phones.length === 0) {
    return { sent: 0, skipped: 0, errors: [] };
  }

  const body = formatEventWhatsappMessage({
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    location: event.location,
    companyName: event.tenant.name,
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const phone of phones) {
    try {
      await sendWhatsappMessage(tenantId, phone, body);
      sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao enviar';
      errors.push(`Falha para ${phone}: ${message}`);
      skipped += 1;
      if (/não ligado|desligado|Bridge/i.test(message)) {
        errors.push('WhatsApp desligado — notificações por WhatsApp não enviadas');
        break;
      }
    }
  }

  return { sent, skipped, errors };
}

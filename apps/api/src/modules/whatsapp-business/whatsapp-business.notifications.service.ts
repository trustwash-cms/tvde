import { prisma } from '@tvde/database';
import {
  WHATSAPP_BUSINESS_EVENT_KEYS,
  formatWhatsappBusinessPhone,
  type WhatsappBusinessEventKey,
  type WhatsappBusinessTemplateSummary,
} from '@tvde/shared';
import {
  EmailNotConfiguredError,
  sendUserWelcomeEmail,
} from '../../services/email.service';
import { sendPaymentReportEmail } from '../../services/payment-report-email.service';
import {
  getWhatsappBusinessConfigRecord,
  getWhatsappBusinessTemplateHeaderUrl,
  listWhatsappBusinessNotificationEvents,
} from './whatsapp-business.config.service';
import {
  listWhatsappBusinessTemplates,
  sendWhatsappBusinessTemplateMessage,
} from './whatsapp-business.graph.client';
import { getWhatsappActiveProvider } from './whatsapp-provider.service';

export type WhatsappBusinessDispatchResult = {
  eventKey: WhatsappBusinessEventKey;
  emailSent: boolean;
  whatsappSent: boolean;
  skipped: string[];
  errors: string[];
};

export type UserAccountNotifyContext = {
  temporaryPassword?: string;
  roleLabel?: string;
};

export type PaymentNotifyContext = {
  reportId: string;
  periodStart: string;
  periodEnd: string;
  resultAmount?: number;
};

function formatDatePtLong(ymd: string): string {
  if (!ymd) return '—';
  const date = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' });
}

function formatMoneyPt(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '€ 0,00';
  return `€ ${value.toLocaleString('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayName(user: {
  fullName: string | null;
  username: string | null;
  email: string;
}): string {
  return user.fullName?.trim() || user.username?.trim() || user.email;
}

function buildContextMap(
  eventKey: WhatsappBusinessEventKey,
  user: { fullName: string | null; username: string | null; email: string },
  context: UserAccountNotifyContext | PaymentNotifyContext
): Record<string, string> {
  const name = displayName(user);
  const map: Record<string, string> = {
    driver_name: name,
    user_name: name,
    name,
    username: user.username ?? '',
    driver_email: user.email,
    user_email: user.email,
    email: user.email,
    '1': name,
  };

  if (eventKey === WHATSAPP_BUSINESS_EVENT_KEYS.driverWeeklyPayment && 'reportId' in context) {
    const start = formatDatePtLong(context.periodStart);
    const end = formatDatePtLong(context.periodEnd);
    const amount = formatMoneyPt(context.resultAmount);
    Object.assign(map, {
      inicio_semana: start,
      fim_semana: end,
      period_start: start,
      period_end: end,
      resultado_final: amount,
      amount,
      '2': start,
      '3': end,
      '4': amount,
    });
  }

  if ('temporaryPassword' in context && context.temporaryPassword) {
    Object.assign(map, {
      temporary_password: context.temporaryPassword,
      password: context.temporaryPassword,
      '2': context.temporaryPassword,
      '3': context.roleLabel ?? '',
    });
  }

  return map;
}

function resolveTemplateParameters(
  template: WhatsappBusinessTemplateSummary,
  contextMap: Record<string, string>
): { parameters: string[]; parameterNames?: string[] } {
  if (template.parameterType === 'named') {
    const names = template.parameters.filter((p): p is string => typeof p === 'string');
    return {
      parameters: names.map(
        (name) => contextMap[name] ?? contextMap[name.toLowerCase()] ?? ''
      ),
      parameterNames: names,
    };
  }

  const indexes =
    template.parameters.length > 0
      ? template.parameters.filter((p): p is number => typeof p === 'number')
      : Array.from({ length: template.parametersCount }, (_, i) => i + 1);

  return {
    parameters: indexes.map((index) => contextMap[String(index)] ?? ''),
  };
}

async function sendConfiguredWhatsapp(input: {
  tenantId: string;
  phone: string;
  templateName: string;
  language: string;
  contextMap: Record<string, string>;
}): Promise<void> {
  const provider = await getWhatsappActiveProvider(input.tenantId);
  if (provider !== 'official') {
    throw new Error('API Oficial WhatsApp não está activa');
  }

  const config = await getWhatsappBusinessConfigRecord(input.tenantId);
  if (!config?.enabled) {
    throw new Error('Módulo WhatsApp Business API está inactivo');
  }

  const templates = await listWhatsappBusinessTemplates(config, { approvedOnly: true });
  const templateInfo =
    templates.find(
      (item) => item.name === input.templateName && item.language === input.language
    ) ??
    templates.find((item) => item.name === input.templateName) ??
    null;

  if (!templateInfo) {
    throw new Error(`Template aprovado «${input.templateName}» não encontrado`);
  }

  const language = templateInfo.language || input.language;
  const { parameters, parameterNames } = resolveTemplateParameters(
    templateInfo,
    input.contextMap
  );

  let headerMediaUrl: string | null = null;
  const headerFormat = templateInfo.headerFormat?.toUpperCase() ?? '';
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
    headerMediaUrl = await getWhatsappBusinessTemplateHeaderUrl(
      input.tenantId,
      templateInfo.name,
      language
    );
    if (!headerMediaUrl?.trim()) {
      throw new Error(
        `Template «${templateInfo.name}» tem cabeçalho ${headerFormat} — defina a URL da imagem em Configurações → WhatsApp Oficial`
      );
    }
  }

  await sendWhatsappBusinessTemplateMessage(config, {
    to: formatWhatsappBusinessPhone(input.phone),
    templateName: templateInfo.name,
    languageCode: language,
    parameters,
    parameterNames,
    headerMediaUrl,
    templateInfo,
  });
}

/**
 * Dispara email e/ou WhatsApp conforme a configuração do evento no tenant.
 * Falhas num canal não bloqueiam o outro.
 */
export async function dispatchWhatsappBusinessEvent(
  tenantId: string,
  eventKey: WhatsappBusinessEventKey,
  targetUserId: string,
  context: UserAccountNotifyContext | PaymentNotifyContext = {}
): Promise<WhatsappBusinessDispatchResult> {
  const result: WhatsappBusinessDispatchResult = {
    eventKey,
    emailSent: false,
    whatsappSent: false,
    skipped: [],
    errors: [],
  };

  const events = await listWhatsappBusinessNotificationEvents(tenantId);
  const eventConfig = events.find((item) => item.eventKey === eventKey);
  if (!eventConfig) {
    result.skipped.push('Evento sem configuração');
    return result;
  }

  const user = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId },
    select: {
      id: true,
      email: true,
      fullName: true,
      username: true,
      phone: true,
      role: true,
      tenant: { select: { name: true, siteId: true } },
    },
  });

  if (!user) {
    result.errors.push('Utilizador destino não encontrado');
    return result;
  }

  const contextMap = buildContextMap(eventKey, user, context);

  if (eventConfig.emailEnabled) {
    try {
      if (
        eventKey === WHATSAPP_BUSINESS_EVENT_KEYS.driverWeeklyPayment &&
        'reportId' in context
      ) {
        await sendPaymentReportEmail(prisma, tenantId, context.reportId);
        result.emailSent = true;
      } else if (
        (eventKey === WHATSAPP_BUSINESS_EVENT_KEYS.userAccountDriver ||
          eventKey === WHATSAPP_BUSINESS_EVENT_KEYS.userAccountManager) &&
        'temporaryPassword' in context &&
        context.temporaryPassword
      ) {
        await sendUserWelcomeEmail({
          tenantId,
          to: user.email,
          tenantName: user.tenant?.name ?? 'TVDE',
          tenantSiteId: user.tenant?.siteId ?? '',
          userEmail: user.email,
          username: user.username ?? user.email,
          roleLabel: context.roleLabel ?? String(user.role),
          temporaryPassword: context.temporaryPassword,
        });
        result.emailSent = true;
      } else if (
        eventKey === WHATSAPP_BUSINESS_EVENT_KEYS.userAccountDriver ||
        eventKey === WHATSAPP_BUSINESS_EVENT_KEYS.userAccountManager
      ) {
        result.skipped.push('Email: sem password temporária (definida manualmente)');
      }
    } catch (err) {
      if (err instanceof EmailNotConfiguredError) {
        throw err;
      }
      result.errors.push(`Email: ${err instanceof Error ? err.message : 'falha'}`);
    }
  } else {
    result.skipped.push('Email desactivado no evento');
  }

  if (eventConfig.whatsappEnabled) {
    if (!eventConfig.whatsappTemplate?.trim()) {
      result.errors.push('WhatsApp: template não seleccionado');
    } else if (!user.phone?.trim()) {
      result.skipped.push('WhatsApp: utilizador sem telefone');
    } else {
      try {
        await sendConfiguredWhatsapp({
          tenantId,
          phone: user.phone,
          templateName: eventConfig.whatsappTemplate.trim(),
          language: eventConfig.whatsappLanguage || 'pt_PT',
          contextMap,
        });
        result.whatsappSent = true;
      } catch (err) {
        result.errors.push(`WhatsApp: ${err instanceof Error ? err.message : 'falha'}`);
      }
    }
  } else {
    result.skipped.push('WhatsApp desactivado no evento');
  }

  return result;
}

export const WHATSAPP_PROVIDERS = ['official', 'generic'] as const;
export type WhatsappProvider = (typeof WHATSAPP_PROVIDERS)[number];

export const WHATSAPP_PROVIDER_LABELS: Record<WhatsappProvider, string> = {
  official: 'API Oficial',
  generic: 'API Genérica',
};

export const LEGACY_PORTAL_HOSTS = [
  'app.tvde.one',
  'www.app.tvde.one',
  'tvde.one',
  'www.tvde.one',
] as const;

export function getUrlHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLegacyPortalUrl(url: string): boolean {
  const host = getUrlHostname(url);
  if (!host) return false;
  return (LEGACY_PORTAL_HOSTS as readonly string[]).includes(host);
}

export function isDynamicUrlButton(url: string): boolean {
  return /\{\{\s*1\s*\}\}/.test(url);
}

/**
 * Reescreve URLs legadas só para preview local.
 * NÃO altera o que o WhatsApp abre — o domínio do botão vem do template Meta.
 */
export function rewritePortalUrl(url: string, portalBaseUrl: string): string {
  if (!url.trim() || !portalBaseUrl.trim()) return url;
  try {
    const target = new URL(portalBaseUrl);
    const parsed = new URL(url, portalBaseUrl);
    if (LEGACY_PORTAL_HOSTS.includes(parsed.hostname as (typeof LEGACY_PORTAL_HOSTS)[number])) {
      parsed.protocol = target.protocol;
      parsed.hostname = target.hostname;
      parsed.port = target.port;
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

/** Sufixo enviado à Meta em botões URL dinâmicos (`https://dominio/{{1}}`). */
export function portalLoginPath(portalBaseUrl: string): string {
  try {
    const parsed = new URL(portalBaseUrl);
    const path = `${parsed.pathname}${parsed.search}`.replace(/^\//, '');
    return path || 'login';
  } catch {
    return 'login';
  }
}

/** Lista botões URL do Meta cujo domínio não coincide com o portal configurado. */
export function findTemplatePortalUrlMismatches(
  templates: WhatsappBusinessTemplateSummary[],
  portalPublicUrl: string | null
): Array<{ template: string; language: string; button: string; metaUrl: string }> {
  const portalHost = portalPublicUrl ? getUrlHostname(portalPublicUrl) : null;
  const mismatches: Array<{ template: string; language: string; button: string; metaUrl: string }> =
    [];

  for (const template of templates) {
    for (const button of template.buttons) {
      if (button.type.toUpperCase() !== 'URL' || !button.url) continue;
      const metaHost = getUrlHostname(button.url.replace(/\{\{\s*1\s*\}\}/g, 'x'));
      if (!metaHost) continue;
      const legacy = (LEGACY_PORTAL_HOSTS as readonly string[]).includes(metaHost);
      const hostMismatch = portalHost ? metaHost !== portalHost && metaHost !== `www.${portalHost}` : legacy;
      if (legacy || hostMismatch) {
        mismatches.push({
          template: template.name,
          language: template.language,
          button: button.text,
          metaUrl: button.url,
        });
      }
    }
  }

  return mismatches;
}

export function applyPortalUrlToTemplates(
  templates: WhatsappBusinessTemplateSummary[],
  portalPublicUrl: string | null
): WhatsappBusinessTemplateSummary[] {
  if (!portalPublicUrl) return templates;
  return templates.map((template) => ({
    ...template,
    buttons: template.buttons.map((button) => ({
      ...button,
      url: button.url ? rewritePortalUrl(button.url, portalPublicUrl) : undefined,
    })),
  }));
}

export const WHATSAPP_BUSINESS_API_VERSIONS = ['v18.0', 'v19.0', 'v20.0', 'v21.0'] as const;

export const WHATSAPP_BUSINESS_EVENT_KEYS = {
  driverWeeklyPayment: 'driver_weekly_payment_generated',
  userAccountDriver: 'user_account_created_driver_admin',
  userAccountManager: 'user_account_created_manager_superadmin',
} as const;

export type WhatsappBusinessEventKey =
  (typeof WHATSAPP_BUSINESS_EVENT_KEYS)[keyof typeof WHATSAPP_BUSINESS_EVENT_KEYS];

export const WHATSAPP_BUSINESS_EVENT_META: Record<
  WhatsappBusinessEventKey,
  { title: string; description: string; icon: 'payment' | 'driver' | 'manager' }
> = {
  [WHATSAPP_BUSINESS_EVENT_KEYS.driverWeeklyPayment]: {
    title: 'Pagamento Semanal do Motorista',
    description: 'Enviado quando o relatório de pagamento semanal é gerado',
    icon: 'payment',
  },
  [WHATSAPP_BUSINESS_EVENT_KEYS.userAccountDriver]: {
    title: 'Criação de Conta — Motorista',
    description: 'Enviado quando uma nova conta de motorista é criada',
    icon: 'driver',
  },
  [WHATSAPP_BUSINESS_EVENT_KEYS.userAccountManager]: {
    title: 'Criação de Conta — Gestor',
    description: 'Enviado quando uma nova conta de gestor (superadmin) é criada',
    icon: 'manager',
  },
};

export const WHATSAPP_BUSINESS_LANGUAGE_OPTIONS = [
  { value: 'pt', label: 'Português (pt)' },
  { value: 'pt_PT', label: 'Português Portugal (pt_PT)' },
  { value: 'en_US', label: 'Inglês (en_US)' },
  { value: 'es', label: 'Espanhol (es)' },
  { value: 'fr', label: 'Francês (fr)' },
] as const;

export const WHATSAPP_TEMPLATE_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'] as const;
export type WhatsappTemplateCategory = (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];

export const WHATSAPP_TEMPLATE_CATEGORY_LABELS: Record<WhatsappTemplateCategory, string> = {
  UTILITY: 'Serviços (Utility)',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticação',
};

export const WHATSAPP_TEMPLATE_NAME_PATTERN = /^[a-z0-9_]+$/;

export interface WhatsappBusinessConfigPublic {
  phoneNumberId: string;
  businessAccountId: string | null;
  apiVersion: string;
  enabled: boolean;
  testMode: boolean;
  portalPublicUrl: string | null;
  defaultPortalPublicUrl: string | null;
  configured: boolean;
  accessTokenConfigured: boolean;
  accessTokenPreview: string | null;
}

export interface WhatsappBusinessAccountStatus {
  verifiedName: string | null;
  verificationStatus: string | null;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
  platformType: string | null;
  throughputLevel: string | null;
}

export interface WhatsappBusinessStatusResponse {
  configured: boolean;
  enabled: boolean;
  testMode: boolean;
  accountStatus: WhatsappBusinessAccountStatus | null;
  warnings: string[];
}

export interface WhatsappBusinessTemplateButton {
  type: string;
  text: string;
  url?: string;
}

export interface WhatsappBusinessTemplateSummary {
  id: string | null;
  name: string;
  status: string;
  language: string;
  category: string;
  bodyText: string;
  headerText: string | null;
  headerFormat: string | null;
  footerText: string | null;
  parametersCount: number;
  parameters: Array<number | string>;
  parameterType: 'numeric' | 'named';
  buttons: WhatsappBusinessTemplateButton[];
}

/** Input para criar um template simples via Meta Graph API (Fase 1). */
export interface WhatsappBusinessCreateTemplateInput {
  name: string;
  language: string;
  category: WhatsappTemplateCategory;
  bodyText: string;
  /** Exemplos para cada variável do corpo ({{1}}, {{2}}, …), na ordem. */
  bodyExamples?: string[];
  headerText?: string | null;
  footerText?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  allowCategoryChange?: boolean;
}

export interface WhatsappBusinessCreateTemplateResult {
  id: string;
  status: string;
  category: string;
}

export interface WhatsappBusinessNotificationEventConfig {
  eventKey: WhatsappBusinessEventKey;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappTemplate: string | null;
  whatsappLanguage: string;
  headerMediaUrl?: string | null;
}

export function maskWhatsappAccessToken(token: string): string {
  if (token.length <= 8) return '••••••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function formatWhatsappBusinessPhone(input: string): string {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = `351${digits.slice(1)}`;
  } else if (!digits.startsWith('351') && digits.length === 9) {
    digits = `351${digits}`;
  }
  return digits.replace(/\D/g, '');
}

export function parseWhatsappTemplateParameters(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Extrai índices numéricos {{1}}, {{2}} … do texto (únicos, ordenados). */
export function extractWhatsappBodyVariableIndexes(text: string): number[] {
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  const indexes = matches.map((match) => Number(match.replace(/\{\{\s*|\s*\}\}/g, '')));
  return Array.from(new Set(indexes)).sort((a, b) => a - b);
}

export function renderWhatsappTemplatePreview(
  template: Pick<WhatsappBusinessTemplateSummary, 'bodyText' | 'headerText' | 'buttons' | 'parameterType' | 'parameters'>,
  parameterValues: string[]
): { header: string | null; body: string; buttons: WhatsappBusinessTemplateButton[] } {
  let body = template.bodyText;
  if (template.parameterType === 'named') {
    const names = template.parameters.filter((p): p is string => typeof p === 'string');
    names.forEach((name, index) => {
      const value = parameterValues[index] ?? `{{${name}}}`;
      body = body.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'), value);
    });
  } else {
    template.parameters.forEach((_param, index) => {
      const value = parameterValues[index] ?? `{{${index + 1}}}`;
      body = body.replace(new RegExp(`\\{\\{\\s*${index + 1}\\s*\\}\\}`, 'g'), value);
    });
  }

  return {
    header: template.headerText,
    body,
    buttons: template.buttons,
  };
}

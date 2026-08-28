import {
  applyPortalUrlToTemplates,
  extractWhatsappBodyVariableIndexes,
  formatWhatsappBusinessPhone,
  portalLoginPath,
  type WhatsappBusinessAccountStatus,
  type WhatsappBusinessCreateTemplateInput,
  type WhatsappBusinessCreateTemplateResult,
  type WhatsappBusinessStatusResponse,
  type WhatsappBusinessTemplateSummary,
} from '@tvde/shared';
import type { WhatsappBusinessConfigRecord } from './whatsapp-business.config.service';
import { getDefaultPortalPublicUrl } from './whatsapp-provider.service';

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
}

function graphBaseUrl(apiVersion: string) {
  return `https://graph.facebook.com/${apiVersion}`;
}

async function graphRequest<T>(
  config: WhatsappBusinessConfigRecord,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${graphBaseUrl(config.apiVersion)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  const json = (await res.json()) as T & GraphErrorBody;
  if (!res.ok || json.error) {
    const message = json.error?.message ?? `Graph API error (${res.status})`;
    const code = json.error?.code;
    throw new Error(code ? `(#${code}) ${message}` : message);
  }
  return json;
}

function extractNamedParameters(text: string): string[] {
  const matches = text.match(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g) ?? [];
  return matches.map((match) => match.replace(/\{\{\s*|\s*\}\}/g, ''));
}

function extractNumericParameters(text: string): number[] {
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  return matches.map((match) => Number(match.replace(/\{\{\s*|\s*\}\}/g, '')));
}

function parseTemplate(raw: Record<string, unknown>): WhatsappBusinessTemplateSummary {
  const components = (raw.components as Array<Record<string, unknown>>) ?? [];
  const body = components.find((c) => c.type === 'BODY');
  const header = components.find((c) => c.type === 'HEADER');
  const footer = components.find((c) => c.type === 'FOOTER');
  const buttonsComponent = components.find((c) => c.type === 'BUTTONS');

  const bodyText = typeof body?.text === 'string' ? body.text : '';
  const namedParams = extractNamedParameters(bodyText);
  const numericParams = extractNumericParameters(bodyText);
  const parameterType = namedParams.length > 0 ? 'named' : 'numeric';
  const parameters: Array<number | string> =
    parameterType === 'named' ? namedParams : numericParams.length > 0 ? numericParams : [];

  const buttons =
    ((buttonsComponent?.buttons as Array<Record<string, unknown>>) ?? []).map((button) => ({
      type: String(button.type ?? 'URL'),
      text: String(button.text ?? ''),
      url: typeof button.url === 'string' ? button.url : undefined,
    })) ?? [];

  return {
    id: typeof raw.id === 'string' ? raw.id : raw.id != null ? String(raw.id) : null,
    name: String(raw.name ?? ''),
    status: String(raw.status ?? 'UNKNOWN'),
    language: String(raw.language ?? 'pt'),
    category: String(raw.category ?? 'UTILITY'),
    bodyText,
    headerText: typeof header?.text === 'string' ? header.text : null,
    headerFormat: typeof header?.format === 'string' ? header.format : null,
    footerText: typeof footer?.text === 'string' ? footer.text : null,
    parametersCount: parameters.length,
    parameters,
    parameterType,
    buttons,
  };
}

function buildUrlButtonComponents(
  templateInfo: WhatsappBusinessTemplateSummary | null | undefined,
  portalPublicUrl: string | null
): Array<Record<string, unknown>> {
  if (!templateInfo?.buttons.length) return [];
  const loginSuffix = portalPublicUrl ? portalLoginPath(portalPublicUrl) : 'login';
  const components: Array<Record<string, unknown>> = [];

  templateInfo.buttons.forEach((button, index) => {
    if (button.type.toUpperCase() !== 'URL') return;
    const url = button.url ?? '';
    if (/\{\{\s*1\s*\}\}/.test(url)) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: String(index),
        parameters: [{ type: 'text', text: loginSuffix }],
      });
    }
  });

  return components;
}

export async function checkWhatsappBusinessStatus(
  config: WhatsappBusinessConfigRecord
): Promise<WhatsappBusinessStatusResponse> {
  const configured = Boolean(config.accessToken && config.phoneNumberId);
  if (!configured) {
    return {
      configured: false,
      enabled: config.enabled,
      testMode: config.testMode,
      accountStatus: null,
      warnings: ['Access Token e Phone Number ID são obrigatórios'],
    };
  }

  try {
    const data = await graphRequest<Record<string, unknown>>(
      config,
      `/${encodeURIComponent(config.phoneNumberId)}?fields=verified_name,code_verification_status,display_phone_number,quality_rating,platform_type,throughput`
    );

    const accountStatus: WhatsappBusinessAccountStatus = {
      verifiedName: typeof data.verified_name === 'string' ? data.verified_name : null,
      verificationStatus:
        typeof data.code_verification_status === 'string' ? data.code_verification_status : null,
      displayPhoneNumber:
        typeof data.display_phone_number === 'string' ? data.display_phone_number : null,
      qualityRating: typeof data.quality_rating === 'string' ? data.quality_rating : null,
      platformType: typeof data.platform_type === 'string' ? data.platform_type : null,
      throughputLevel: typeof data.throughput === 'string' ? data.throughput : null,
    };

    const warnings: string[] = [];
    if (accountStatus.verificationStatus && accountStatus.verificationStatus !== 'VERIFIED') {
      warnings.push('A conta não está verificada. Algumas funcionalidades podem estar limitadas.');
    }
    if (accountStatus.platformType === 'NOT_APPLICABLE') {
      warnings.push('platform_type NOT_APPLICABLE — confirme o Phone Number ID no Meta Business Manager.');
    }

    return {
      configured: true,
      enabled: config.enabled,
      testMode: config.testMode,
      accountStatus,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao verificar status';
    return {
      configured: true,
      enabled: config.enabled,
      testMode: config.testMode,
      accountStatus: null,
      warnings: [message],
    };
  }
}

export async function sendWhatsappBusinessTextMessage(
  config: WhatsappBusinessConfigRecord,
  to: string,
  message: string
) {
  if (config.testMode) {
    return { messageId: `test_${Date.now()}`, mocked: true as const };
  }
  if (!config.enabled) {
    throw new Error('Módulo WhatsApp Business API está inactivo');
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: formatWhatsappBusinessPhone(to),
    type: 'text',
    text: { body: message },
  };

  const data = await graphRequest<{ messages?: Array<{ id?: string }> }>(
    config,
    `/${encodeURIComponent(config.phoneNumberId)}/messages`,
    { method: 'POST', body: JSON.stringify(payload) }
  );

  return {
    messageId: data.messages?.[0]?.id ?? null,
    mocked: false as const,
  };
}

export async function listWhatsappBusinessTemplates(
  config: WhatsappBusinessConfigRecord,
  options?: { approvedOnly?: boolean }
): Promise<WhatsappBusinessTemplateSummary[]> {
  if (!config.businessAccountId) {
    throw new Error('Business Account ID é necessário para listar templates');
  }

  const data = await graphRequest<{ data?: Array<Record<string, unknown>> }>(
    config,
    `/${encodeURIComponent(config.businessAccountId)}/message_templates?limit=100`
  );

  const approvedOnly = options?.approvedOnly !== false;
  return (data.data ?? [])
    .filter((item) => !approvedOnly || String(item.status ?? '') === 'APPROVED')
    .map(parseTemplate)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWhatsappBusinessTemplate(
  config: WhatsappBusinessConfigRecord,
  input: WhatsappBusinessCreateTemplateInput
): Promise<WhatsappBusinessCreateTemplateResult> {
  if (!config.businessAccountId) {
    throw new Error('Business Account ID é necessário para criar templates');
  }

  const name = input.name.trim().toLowerCase();
  const bodyText = input.bodyText.trim();
  if (!bodyText) {
    throw new Error('O texto do corpo é obrigatório');
  }

  const variableIndexes = extractWhatsappBodyVariableIndexes(bodyText);
  const examples = (input.bodyExamples ?? []).map((value) => value.trim()).filter(Boolean);
  if (variableIndexes.length > 0 && examples.length < variableIndexes.length) {
    throw new Error(
      `Indique um exemplo para cada variável do corpo ({{${variableIndexes.join('}}, {{')}})`
    );
  }

  const components: Array<Record<string, unknown>> = [];

  const headerText = input.headerText?.trim();
  if (headerText) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: headerText,
    });
  }

  const bodyComponent: Record<string, unknown> = {
    type: 'BODY',
    text: bodyText,
  };
  if (variableIndexes.length > 0) {
    const orderedExamples = variableIndexes.map((_, index) => examples[index] ?? `exemplo${index + 1}`);
    bodyComponent.example = { body_text: [orderedExamples] };
  }
  components.push(bodyComponent);

  const footerText = input.footerText?.trim();
  if (footerText) {
    components.push({
      type: 'FOOTER',
      text: footerText,
    });
  }

  const buttonText = input.buttonText?.trim();
  const buttonUrl = input.buttonUrl?.trim();
  if (buttonText && buttonUrl) {
    components.push({
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: buttonText.slice(0, 25),
          url: buttonUrl,
        },
      ],
    });
  } else if (buttonText || buttonUrl) {
    throw new Error('Botão URL requer texto e URL');
  }

  const payload = {
    name,
    language: input.language,
    category: input.category,
    allow_category_change: input.allowCategoryChange !== false,
    components,
  };

  const data = await graphRequest<{ id?: string; status?: string; category?: string }>(
    config,
    `/${encodeURIComponent(config.businessAccountId)}/message_templates`,
    { method: 'POST', body: JSON.stringify(payload) }
  );

  return {
    id: String(data.id ?? ''),
    status: String(data.status ?? 'PENDING'),
    category: String(data.category ?? input.category),
  };
}

export async function deleteWhatsappBusinessTemplate(
  config: WhatsappBusinessConfigRecord,
  name: string,
  hsmId?: string | null
): Promise<void> {
  if (!config.businessAccountId) {
    throw new Error('Business Account ID é necessário para apagar templates');
  }

  const params = new URLSearchParams({ name: name.trim() });
  if (hsmId?.trim()) {
    params.set('hsm_id', hsmId.trim());
  }

  await graphRequest(
    config,
    `/${encodeURIComponent(config.businessAccountId)}/message_templates?${params.toString()}`,
    { method: 'DELETE' }
  );
}

export function withPortalTemplateUrls(
  templates: WhatsappBusinessTemplateSummary[],
  portalPublicUrl: string | null
) {
  const effective =
    portalPublicUrl?.trim() ||
    null;
  return applyPortalUrlToTemplates(templates, effective);
}

export interface SendWhatsappBusinessTemplateInput {
  to: string;
  templateName: string;
  languageCode: string;
  parameters?: string[];
  parameterNames?: string[];
  headerMediaUrl?: string | null;
  templateInfo?: WhatsappBusinessTemplateSummary | null;
}

export async function sendWhatsappBusinessTemplateMessage(
  config: WhatsappBusinessConfigRecord,
  input: SendWhatsappBusinessTemplateInput
) {
  if (config.testMode) {
    return { messageId: `test_${Date.now()}`, mocked: true as const };
  }
  if (!config.enabled) {
    throw new Error('Módulo WhatsApp Business API está inactivo');
  }

  const components: Array<Record<string, unknown>> = [];
  const templateInfo = input.templateInfo;
  const headerFormat = templateInfo?.headerFormat?.toUpperCase() ?? null;
  const headerMediaUrl = input.headerMediaUrl?.trim();

  if (headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat) && headerMediaUrl) {
    const mediaKey = headerFormat.toLowerCase();
    components.push({
      type: 'header',
      parameters: [
        {
          type: mediaKey,
          [mediaKey]: { link: headerMediaUrl },
        },
      ],
    });
  }

  const parameters = input.parameters ?? [];
  if (parameters.length > 0) {
    const bodyParameters =
      input.parameterNames && input.parameterNames.length > 0
        ? parameters.map((text, index) => ({
            type: 'text',
            parameter_name: input.parameterNames![index],
            text,
          }))
        : parameters.map((text) => ({ type: 'text', text }));

    components.push({
      type: 'body',
      parameters: bodyParameters,
    });
  }

  components.push(
    ...buildUrlButtonComponents(
      templateInfo,
      config.portalPublicUrl ?? getDefaultPortalPublicUrl()
    )
  );

  const payload = {
    messaging_product: 'whatsapp',
    to: formatWhatsappBusinessPhone(input.to),
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const data = await graphRequest<{ messages?: Array<{ id?: string }> }>(
    config,
    `/${encodeURIComponent(config.phoneNumberId)}/messages`,
    { method: 'POST', body: JSON.stringify(payload) }
  );

  return {
    messageId: data.messages?.[0]?.id ?? null,
    mocked: false as const,
  };
}

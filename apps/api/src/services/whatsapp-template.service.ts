import { prisma } from '@tvde/database';
import { getServerConfig } from '@tvde/shared/server';
import { sendFormattedWhatsappMessage } from './whatsapp-bridge.client';

export const WHATSAPP_TEMPLATE_KEYS = {
  otp: 'otp',
  plain: 'plain',
} as const;

export type WhatsappTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[keyof typeof WHATSAPP_TEMPLATE_KEYS];

const DEFAULT_TEMPLATES: Record<
  WhatsappTemplateKey,
  { body: string; variables: string[] }
> = {
  otp: {
    body: `*{{appName}}*
O seu código de verificação é *{{code}}*
Expira em 5 minutos.
{{link}}`,
    variables: ['appName', 'code', 'link'],
  },
  plain: {
    body: '{{text}}',
    variables: ['text'],
  },
};

function renderTemplate(text: string, variables: Record<string, string>): string {
  const rendered = text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? '');
  return rendered
    .split('\n')
    .filter((line, index, lines) => {
      if (line.trim() !== '') return true;
      return index > 0 && lines[index - 1]?.trim() !== '';
    })
    .join('\n')
    .trim();
}

export async function listWhatsappTemplates(tenantId: string) {
  const rows = await prisma.whatsappTemplate.findMany({
    where: { tenantId },
    orderBy: { key: 'asc' },
  });
  const keys = Object.values(WHATSAPP_TEMPLATE_KEYS);

  return keys.map((key) => {
    const custom = rows.find((r) => r.key === key);
    const fallback = DEFAULT_TEMPLATES[key];
    return (
      custom ?? {
        key,
        body: fallback.body,
        variables: fallback.variables,
        isDefault: true as const,
      }
    );
  });
}

export async function upsertWhatsappTemplate(
  tenantId: string,
  key: WhatsappTemplateKey,
  input: { body: string }
) {
  const fallback = DEFAULT_TEMPLATES[key];
  const existing = await prisma.whatsappTemplate.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });

  if (existing) {
    return prisma.whatsappTemplate.update({
      where: { tenantId_key: { tenantId, key } },
      data: { body: input.body },
    });
  }

  return prisma.whatsappTemplate.create({
    data: {
      tenantId,
      key,
      body: input.body,
      variables: fallback.variables,
    },
  });
}

export async function renderWhatsappTemplate(
  tenantId: string,
  key: WhatsappTemplateKey,
  variables: Record<string, string>
): Promise<string> {
  const rows = await listWhatsappTemplates(tenantId);
  const template = rows.find((t) => t.key === key);
  const body = template?.body ?? DEFAULT_TEMPLATES[key].body;
  return renderTemplate(body, variables);
}

export async function sendOtpWhatsappWithTemplate(
  tenantId: string,
  to: string,
  code: string,
  link?: string
) {
  const { appName } = getServerConfig();
  const text = await renderWhatsappTemplate(tenantId, WHATSAPP_TEMPLATE_KEYS.otp, {
    appName,
    code,
    link: link ?? '',
  });

  return sendFormattedWhatsappMessage(tenantId, to, { template: 'plain', text });
}

export async function sendWhatsappTemplateTest(
  tenantId: string,
  to: string,
  key: WhatsappTemplateKey = WHATSAPP_TEMPLATE_KEYS.otp
) {
  const { appName } = getServerConfig();
  const variables: Record<string, string> =
    key === WHATSAPP_TEMPLATE_KEYS.plain
      ? { text: `Teste WhatsApp — ${appName}. Configuração OK.` }
      : {
          appName,
          code: '123456',
          link: '',
        };

  const text = await renderWhatsappTemplate(tenantId, key, variables);
  return sendFormattedWhatsappMessage(tenantId, to, { template: 'plain', text });
}

export { DEFAULT_TEMPLATES as DEFAULT_WHATSAPP_TEMPLATES };

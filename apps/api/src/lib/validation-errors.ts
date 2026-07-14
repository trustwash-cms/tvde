import { ZodError, type ZodIssue } from 'zod';

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  password: 'Password',
  role: 'Perfil',
  tenantId: 'Tenant',
  workspaceId: 'Workspace',
  name: 'Nome',
  siteId: 'Site ID',
  phone: 'Telefone',
  nif: 'NIF',
};

function fieldLabel(path: (string | number)[]): string {
  const key = String(path[0] ?? 'campo');
  return FIELD_LABELS[key] ?? key;
}

function issueMessage(issue: ZodIssue): string {
  const label = fieldLabel(issue.path);

  switch (issue.code) {
    case 'too_small':
      if (issue.type === 'string') {
        return `${label} deve ter pelo menos ${issue.minimum} caracteres`;
      }
      if (issue.type === 'array') {
        return `${label} deve ter pelo menos ${issue.minimum} item(ns)`;
      }
      return `${label} demasiado curto`;
    case 'too_big':
      if (issue.type === 'string') {
        return `${label} deve ter no máximo ${issue.maximum} caracteres`;
      }
      return `${label} demasiado longo`;
    case 'invalid_string':
      if (issue.validation === 'email') return `${label} inválido`;
      if (issue.validation === 'uuid') return `${label} inválido`;
      return `${label} inválido`;
    case 'invalid_type':
      return `${label} inválido`;
    case 'invalid_enum_value':
      return `${label} inválido`;
    default:
      return issue.message ? `${label}: ${issue.message}` : `${label} inválido`;
  }
}

export function formatZodError(error: ZodError): string {
  return error.issues.map(issueMessage).join('; ');
}

export function formatFastifyValidation(details: unknown): string | null {
  if (!Array.isArray(details) || details.length === 0) return null;
  const messages = details
    .map((item) => {
      if (item && typeof item === 'object' && 'message' in item && typeof item.message === 'string') {
        return item.message;
      }
      return null;
    })
    .filter(Boolean) as string[];
  return messages.length ? messages.join('; ') : null;
}

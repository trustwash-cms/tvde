/** Formata erros de validação Fastify/Zod devolvidos pela API. */
export function formatValidationDetails(details: unknown): string | null {
  if (!Array.isArray(details) || details.length === 0) return null;

  const messages = details
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      if ('message' in item && typeof item.message === 'string') return item.message;
      if ('code' in item && item.code === 'too_small' && 'path' in item) {
        const path = Array.isArray(item.path) ? item.path[0] : null;
        const minimum = 'minimum' in item ? item.minimum : null;
        const label = path === 'password' ? 'Password' : String(path ?? 'Campo');
        if (minimum != null) return `${label} deve ter pelo menos ${minimum} caracteres`;
      }
      return null;
    })
    .filter(Boolean) as string[];

  return messages.length ? messages.join('; ') : null;
}

/** Fallback quando a API devolve issues Zod serializadas em `error`. */
export function formatZodErrorJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const issues = JSON.parse(trimmed) as Array<{
      message?: string;
      code?: string;
      path?: string[];
      minimum?: number;
    }>;
    if (!Array.isArray(issues)) return null;
    return formatValidationDetails(issues);
  } catch {
    return null;
  }
}

export async function readFetchBody(res: Response): Promise<{ json: unknown; text: string }> {
  const text = await res.text();
  if (!text.trim()) {
    return { json: null, text: '' };
  }
  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { json: null, text };
  }
}

export function pickErrorMessage(
  json: unknown,
  text: string,
  fallback: string
): string {
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['text', 'message', 'error', 'detail', 'description']) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim()) return val;
    }
  }
  if (text.trim()) return text.trim();
  return fallback;
}

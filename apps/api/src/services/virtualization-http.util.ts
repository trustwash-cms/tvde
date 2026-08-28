import type { ClientRequest } from 'node:http';

export const VIRTUALIZATION_HTTP_TIMEOUT_MS = 15_000;

export function applyHttpRequestTimeout(
  req: ClientRequest,
  label: string,
  timeoutMs = VIRTUALIZATION_HTTP_TIMEOUT_MS
): void {
  req.setTimeout(timeoutMs, () => {
    req.destroy(new Error(`${label}: timeout após ${Math.round(timeoutMs / 1000)}s`));
  });
}

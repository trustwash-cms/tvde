import { getApiUrl, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';

/** Constrói URL WebSocket autenticada (token na query). */
export function buildVirtualizationWsUrl(
  websocketPath: string,
  workspaceId: string | null | undefined
): string {
  const token = getStoredToken();
  if (!token) {
    throw new Error('Sessão expirada — volte a iniciar sessão.');
  }
  const apiBase = getApiUrl().replace(/\/$/, '');
  const wsBase = apiBase.replace(/^http/i, (m) => (m.toLowerCase() === 'https' ? 'wss' : 'ws'));
  const path = websocketPath.startsWith('/') ? websocketPath : `/${websocketPath}`;
  return `${wsBase}${withWorkspaceQuery(path, workspaceId, { token })}`;
}

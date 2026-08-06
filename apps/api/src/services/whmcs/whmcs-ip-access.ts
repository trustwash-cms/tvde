/**
 * Parse WHMCS API errors and build Portuguese guidance.
 * We cannot update WHMCS API IP Access Restriction remotely (chicken-egg + no public API).
 */

export type WhmcsIpBlockedInfo = {
  whmcsIpBlocked: true;
  blockedIp: string | null;
  hint: string;
};

export type WhmcsAuthFailedInfo = {
  whmcsAuthFailed: true;
  hint: string;
};

const INVALID_IP_RE =
  /invalid\s+ip(?:\s+(?:address|access))?(?:\s*[:=]?\s*)(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)?/i;

export function isWhmcsInvalidIpError(message: string): boolean {
  return /invalid\s+ip/i.test(message);
}

export function isWhmcsAuthFailedError(message: string): boolean {
  return /authentication\s+failed/i.test(message);
}

export function parseBlockedIpFromWhmcsMessage(message: string): string | null {
  const match = message.match(INVALID_IP_RE);
  const ip = match?.[1]?.trim();
  return ip || null;
}

export function buildWhmcsIpWhitelistHint(ip: string | null): string {
  const display = ip?.trim() || 'o IP de saída da API';
  return (
    `O IP ${display} não está autorizado na whitelist da API WHMCS. ` +
    `No WHMCS Admin: Configuration → System Settings → General Settings → separador Security → ` +
    `API IP Access Restriction → Add IP → colar ${display} → Save Changes. ` +
    `A TVDE não consegue adicionar este IP automaticamente — tem de o fazer no painel WHMCS.`
  );
}

export function buildWhmcsAuthFailedHint(): string {
  return (
    'Autenticação WHMCS falhou (Identifier/Secret). Verifique: ' +
    '(1) Identifier e Secret correctos (API Credentials, não login de admin); ' +
    '(2) o admin associado à credencial está activo; ' +
    '(3) a API Role tem GetInvoices, GetInvoice e GetClientsDetails; ' +
    '(4) se perdeu o secret, regenere em Manage API Credentials e cole o novo na app. ' +
    'Não use username/password de admin — use o par Identifier + Secret.'
  );
}

export function parseWhmcsInvalidIpError(
  message: string,
  egressIp?: string | null
): WhmcsIpBlockedInfo | null {
  if (!isWhmcsInvalidIpError(message)) return null;
  const blockedIp = parseBlockedIpFromWhmcsMessage(message) ?? egressIp?.trim() ?? null;
  return {
    whmcsIpBlocked: true,
    blockedIp,
    hint: buildWhmcsIpWhitelistHint(blockedIp),
  };
}

export function parseWhmcsAuthFailedError(message: string): WhmcsAuthFailedInfo | null {
  if (!isWhmcsAuthFailedError(message)) return null;
  return {
    whmcsAuthFailed: true,
    hint: buildWhmcsAuthFailedHint(),
  };
}

/** Prefer a longer, actionable lastError for sync/worker storage. */
export function formatWhmcsErrorForStorage(
  message: string,
  egressIp?: string | null
): string {
  const ip = parseWhmcsInvalidIpError(message, egressIp);
  if (ip) return ip.hint;
  const auth = parseWhmcsAuthFailedError(message);
  if (auth) return auth.hint;
  return message;
}

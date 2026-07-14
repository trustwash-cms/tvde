export const TENANT_INACTIVE_LOGIN_MESSAGE =
  'A sua conta está inactiva! Por favor contacte o suporte';

export const TEMP_PASSWORD_EXPIRED_MESSAGE =
  'A password temporária expirou. Peça ao administrador um reenvio das credenciais ou utilize «Esqueci a password» no login.';

/** Bloqueia login/sessão de utilizadores cujo tenant não está activo (MASTER sem tenant ignora). */
export function assertTenantActiveForLogin(
  user: { tenantId: string | null; tenant: { status: string } | null }
): void {
  if (!user.tenantId || !user.tenant) return;
  if (user.tenant.status !== 'active') {
    throw new Error(TENANT_INACTIVE_LOGIN_MESSAGE);
  }
}

/** Password temporária de provisionamento expira após 24h se ainda não foi alterada. */
export function assertTempPasswordValid(
  user: { mustChangePassword: boolean; tempPasswordExpiresAt: Date | null }
): void {
  if (!user.mustChangePassword || !user.tempPasswordExpiresAt) return;
  if (user.tempPasswordExpiresAt < new Date()) {
    throw new Error(TEMP_PASSWORD_EXPIRED_MESSAGE);
  }
}

/** Utilizadores com tenant (não-MASTER) têm de indicar siteId válido no login. */
export function assertLoginSiteId(
  user: { tenantId: string | null; tenant: { siteId: string } | null },
  siteId?: string
): void {
  if (!user.tenantId) return;

  const trimmed = siteId?.trim();
  if (!trimmed) {
    throw new Error('Site ID obrigatório');
  }
  if (user.tenant?.siteId !== trimmed) {
    throw new Error('Credenciais inválidas');
  }
}

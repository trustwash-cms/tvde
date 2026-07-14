# 06 — Segurança e multi-tenancy

## Camadas de segurança

```
1. Rede        → HTTPS, firewall, Cloudflare (opcional)
2. API Gateway → Rate limit, CORS, Helmet headers
3. Auth        → JWT + sessões DB + fail2ban
4. Aplicação   → Roles, tenant scoping
5. Base dados  → PostgreSQL RLS
6. Audit       → Log imutável de acções sensíveis
```

---

## Passwords

| Regra | Implementação |
|-------|---------------|
| Hash | bcrypt, cost factor 12 |
| Comprimento mínimo | 12 caracteres |
| Complexidade | Maiúscula + minúscula + número + símbolo |
| Histórico | Schema `password_history` (5 últimas — lógica pendente) |
| HIBP check | Planeado, não implementado |

Ficheiro: `apps/api/src/lib/password.ts`

---

## JWT e sessões

| Aspecto | Detalhe |
|---------|---------|
| Access token | JWT assinado com `JWT_SECRET`, TTL 15min |
| Refresh token | Random hex 48 bytes, hash SHA-256 na DB |
| Sessão DB | `sessions` — IP, user-agent, expires_at |
| Revogação | `is_active = false` no logout |
| Multi-device | Uma row por sessão; revogar individualmente |

### Fluxo de verificação

```
Request → jwtVerify() → buscar session activa → setTenantContext()
```

---

## Fail2ban (Redis)

| Parâmetro | Valor |
|-----------|-------|
| Max tentativas | 5 |
| Bloqueio | 15 minutos |
| Chave Redis | `fail2ban:{ip}` |

Após login bem sucedido: contador limpo.

**MASTER — desbloquear IP:** Configurações → **Segurança** (`/dashboard/settings/security`) ou `GET /platform/fail2ban` + `POST /platform/fail2ban/unblock` com `{ "ip": "..." }`.

Emergência na VPS: `redis-cli DEL "fail2ban:SEU_IP"`.

> Se Redis indisponível, fail2ban desactivado (API continua).

---

## Roles e permissões

> **Documento completo:** [11 — Permissões, roles e módulos](11-permissoes-roles-modulos.md) (matriz por módulo, API, UI, fluxos SMS/WhatsApp/Moloni).

### Cadeia de delegação

```
MASTER → manda em tudo
  └── superadmin → vê/acede ao que o MASTER deixar
        └── admin → vê/acede ao que o superadmin deixar
              └── staff → vê/acede ao que o admin deixar
```

Funções em `@tvde/shared`: `canAssignRole`, `canManageUser`, `canAccessDashboardArea`, `hasMinRole`.

| Endpoint / Área | Role mínima | Delegação |
|-----------------|-------------|-----------|
| GET /tenants | master | Só MASTER |
| POST /tenants | master | Só MASTER |
| PATCH /tenants/:id | master | Desactivar/reactivar tenant |
| DELETE /tenants/:id | master | Eliminação + confirmação email |
| POST /workspaces | superadmin | MASTER + superadmin |
| PATCH workspace modules | superadmin | MASTER + superadmin |
| GET /users | admin | Filtrado por `canManageUser` |
| POST /users | admin | Role limitada por `canAssignRole` |
| GET /audit-logs | admin | admin+ (scoped tenant) |
| Sidebar Workspaces/Módulos | superadmin | staff não vê |
| Sidebar Users/Audit | admin | staff não vê |
| Clients/Products/Billing | staff | + módulo **activo** no workspace (`requireModule` + `ModuleAccessGuard`) |
| Config SMS/WhatsApp/Moloni | superadmin | + módulo activo (`SettingsAccessGuard`) |
| Config SMTP | superadmin | por tenant (sem flag de módulo) |
| Config Módulos (saúde) | superadmin | estado integrações |

Staff acede a clients/products/billing **se** o módulo estiver activo no workspace (`requireModule` + guards UI).

---

## Row-Level Security

Ver [03 — Base de dados](03-base-de-dados.md#row-level-security-rls).

**Crítico em produção:** aplicar `rls.sql` após migrations.

---

## Audit log

Acções registadas actualmente:
- `auth.login`, `auth.logout`, `auth.password_changed`
- `tenant.create`, `tenant.activate`, `tenant.deactivate`, `tenant.delete`
- `tenant_module.allow`, `tenant_module.deny`
- `user.create` (incl. superadmin no provisionamento tenant)
- `workspace.create`
- `seed.completed`

Campos: tenant_id, user_id, action, entity_type, entity_id, before/after JSON, IP, timestamp.

**Append-only** — nunca apagar registos em produção.

---

## Headers HTTP (Helmet)

Activos via `@fastify/helmet`. CSP desactivado em dev para facilitar debug.

Em produção, activar CSP restritivo.

---

## Planeado (arquitectura, parcialmente implementado)

| Feature | Estado | Descrição |
|---------|--------|-----------|
| 2FA TOTP | ✅ | Google Authenticator, backup codes |
| 2FA Email OTP | ✅ | Template `two_fa_email`; 6 dígitos, 10min, 3 tentativas |
| Confirmação delete tenant | ✅ | Código email MASTER (`tenant_delete_confirmation`) |
| Password 1.º acesso | ✅ | `must_change_password` + `/auth/change-password` |
| Tenant inactivo | ✅ | Bloqueio login + revogação sessões |
| 2FA SMS | ✅ | Twilio/Sinch; flag por **tenant**; credenciais globais v1 |
| 2FA WhatsApp | ✅ | Bridge QR; flag por **tenant**; bridge único v1 |
| Cloudflare Turnstile | ✅ | Login + forgot-password |
| CSRF tokens | ❌ | Formulários web |
| Token blacklist Redis | ✅ | JWT blacklist no logout (Redis, TTL = exp) |
| HIBP API | ✅ | `POST` create user + reset password; k-anonymity |
| HTTPS Strict | ❌ | HSTS em produção |
| Encriptação SMTP | ✅ | AES-256-GCM (`crypto.ts`) |

---

## Checklist segurança produção

- [ ] `JWT_SECRET` — string aleatória 64+ chars
- [ ] `ENCRYPTION_KEY` — 32 chars únicos
- [ ] HTTPS em frontend e API
- [ ] `CORS_ORIGIN` — só domínio real do frontend
- [ ] RLS aplicado na DB produção
- [ ] Passwords demo removidas / alteradas
- [ ] Redis com password em produção
- [ ] PostgreSQL não exposto publicamente
- [ ] Backups automáticos DB
- [ ] Rate limit ajustado se necessário
- [ ] Logs de audit monitorizados

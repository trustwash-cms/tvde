# 10 — WhatsApp Business API (Meta Cloud)

Documento do módulo **API Oficial WhatsApp** no TVDE (Cloud API da Meta).  
Não confundir com a **API Genérica** (bridge QR / 2FA legado), que vive no mesmo menu mas noutro código.

| Relacionado | |
|-------------|--|
| Roadmap | [`01-ROADMAP_TVDE.md`](./01-ROADMAP_TVDE.md) |
| Mapa do projecto | [`00-MAPA-DO-PROJECTO.md`](./00-MAPA-DO-PROJECTO.md) |
| Pagamentos (evento + debug) | [`08-PAGAMENTOS.md`](./08-PAGAMENTOS.md) |
| Encriptação de tokens | [`09-ENCRIPTION.MD`](./09-ENCRIPTION.MD) |
| Legado PHP (referência, não é o código actual) | [`ficheiros de exemplo/Whatsapp Business API.md`](./ficheiros%20de%20exemplo/Whatsapp%20Business%20API.md) |

**Última actualização:** 24 Agosto 2026

---

## 1. O que é

Cada tenant (frota) pode enviar templates WhatsApp aprovados pela Meta:

- quando **cria uma conta** de motorista ou gestor;
- quando **grava um pagamento semanal**;
- em testes manuais (texto ou template) nas definições.

O envio real é `POST https://graph.facebook.com/{versão}/{phone-number-id}/messages`.  
O TVDE guarda credenciais **por tenant**, encriptadas, e dispara o envio nos pontos de negócio.

Existem **dois providers** mutuamente exclusivos:

| Provider | Valor | UI | Uso |
|----------|-------|----|-----|
| API Oficial | `official` | `/dashboard/settings/whatsapp/oficial` | Cloud API Meta — este documento |
| API Genérica | `generic` | `/dashboard/settings/whatsapp/generica` | Bridge QR / 2FA (legado) |

Só **um** pode estar activo. A escolha fica em `tenant_settings.key = whatsapp_active_provider`.  
Se o activo for `generic`, o módulo Oficial fica inactivo (`whatsapp_business_configs.enabled = false`) e o painel Oficial fica bloqueado.

---

## 2. Como um gestor de frota configura (passo a passo)

### 2.1 Activar o módulo

1. Login como **Gestor de Frota** (`superadmin`). O MASTER da plataforma **não** configura WhatsApp de um tenant.
2. **Configurações → Módulos** — módulo `whatsapp` activo no tenant/workspace.
3. **Configurações → WhatsApp**.

### 2.2 Credenciais Meta

Na aba **API Oficial**:

| Campo | Obrigatório | Onde obter |
|-------|-------------|------------|
| Access Token | Sim | Meta Developer → App → WhatsApp → API Setup (token permanente de sistema recomendado) |
| Phone Number ID | Sim | O ID do número Cloud API (não o número `+351…`) |
| Business Account ID (WABA) | Sim para listar/criar templates | WhatsApp Business Account ID |
| Versão da API | Não | `v18.0` … `v21.0` (defeito `v18.0`) |
| URL pública do portal | Recomendado | Ex.: `https://fleet.tvde.one` |
| Módulo activo | — | Checkbox |
| Modo teste | — | Se ligado, **não chama a Meta**; devolve `messageId` simulado |

Guardar. O token **nunca** volta no GET — só um preview mascarado (`EAA…xxxx`).

Depois: **Actualizar status** — deve mostrar número, `quality_rating`, verificação.

### 2.3 Ligar o provider Oficial

No selector no topo das definições WhatsApp, activar **API Oficial**.  
Isto desactiva a genérica (2FA WhatsApp do bridge).

### 2.4 Templates

- **Listar aprovados** — só `status = APPROVED`.
- **Criar (Fase 1)** — nome `a-z0-9_`, corpo, opcional header **texto**, footer, botão URL. A Meta aprova (pode ficar `PENDING`).
- Templates com **header IMAGE / VIDEO / DOCUMENT** criam-se no **Meta Business Manager**. No TVDE só se envia e se guarda a **URL pública** da media.

Nomes usados em produção (exemplo Caminhos Tolerantes):

| Template | Idioma | Evento | Notas |
|----------|--------|--------|--------|
| `nova_conta_fleet` | `pt_PT` | Criação de conta | Variáveis nomeadas `{{driver_name}}`, `{{driver_email}}` |
| `pagamento_semana_fleet` | `pt_PT` | Pagamento semanal | `{{driver_name}}`, `{{inicio_semana}}`, `{{fim_semana}}` + header **IMAGE** |

### 2.5 Eventos de notificação

Secção **Configuração de Eventos de Notificação**:

1. Marcar **Enviar email** e/ou **Enviar WhatsApp**.
2. Escolher template **APPROVED** + idioma.
3. Se o template tiver header media → campo **URL da imagem do cabeçalho** (https público). Guardar.
4. **Guardar configuração** em cada cartão.

Sem URL de imagem num template IMAGE, o pagamento falha o WhatsApp com:

`WhatsApp: Template «pagamento_semana_fleet» tem cabeçalho IMAGE — defina a URL da imagem…`

### 2.6 Telefone do destinatário

O envio usa `users.phone`. Motorista/gestor devem ter telemóvel no formato internacional (`+351…`).  
Sem telefone o evento **salta** WhatsApp (`WhatsApp: utilizador sem telefone`).

### 2.7 Debug no pagamento

Depois de **Confirmar e gravar** um pagamento: lista → ícone **olho (ver)** → fundo do modal:

```
emailSent: true
whatsappSent: false
WhatsApp: …
```

Só relatórios **novos** (após 24-08-2026) têm estes campos preenchidos.

---

## 3. Regras da Meta que o TVDE não contorna

- **Templates** — fora da janela de 24h só se envia template aprovado, não texto livre.
- **Botão URL** — o domínio está **gravado no template**. Alterar `portalPublicUrl` no TVDE **não muda** o que o WhatsApp abre. URLs antigas (`app.tvde.one`) exigem **novo template** no Meta com `https://fleet.tvde.one/…`.
- **Header IMAGE** — a Meta exige `link` público no payload de cada envio; não reutiliza automaticamente o ficheiro do Business Manager.
- **Variáveis** — o nome no template (`driver_email`) tem de existir no mapa de contexto do TVDE (ver §7). Nomes em falta → erro Graph `#131008 Required parameter is missing`.

---

## 4. Árvore de ficheiros (implementação actual)

```
packages/shared/src/whatsapp-business.ts     # tipos, eventos, phones, rewrite URL (preview)
packages/shared/src/routes.ts                # WEB_ROUTES + API_PATHS.whatsappBusiness
packages/shared/src/index.ts                 # re-export

packages/database/prisma/schema.prisma
  WhatsappBusinessConfig
  WhatsappBusinessNotificationEvent
  PaymentReport.emailSent / whatsappSent / notificationDebug

packages/database/prisma/migrations/
  20260823140000_whatsapp_business_module/migration.sql
  20260823150000_whatsapp_portal_url/migration.sql
  20260824100000_payment_report_notification_debug/migration.sql

apps/api/src/app.ts                          # register whatsappBusinessRoutes
apps/api/src/lib/crypto.ts                   # encrypt/decrypt do access token
apps/api/src/lib/whatsapp-tenant.ts          # tenant do superadmin (bloqueia master)
apps/api/src/modules/whatsapp-business/
  index.ts
  whatsapp-business.access.ts                # superadmin + módulo whatsapp
  whatsapp-business.config.service.ts        # CRUD config + eventos + header URLs
  whatsapp-business.graph.client.ts          # Graph API (status, templates, send)
  whatsapp-business.notifications.service.ts # dispatchWhatsappBusinessEvent()
  whatsapp-business.routes.ts                # HTTP /whatsapp-business/*
  whatsapp-provider.service.ts               # official | generic

apps/api/src/routes/business.routes.ts       # POST /users → evento conta
apps/api/src/routes/payment.routes.ts        # POST /pagamentos/confirm → evento pagamento
apps/api/src/services/payment-report.service.ts          # persist debug
apps/api/src/services/payment-report-email.service.ts    # email do relatório

apps/web/src/app/dashboard/settings/whatsapp/
  layout.tsx
  page.tsx                                   # redirect → /oficial
  oficial/page.tsx
  generica/page.tsx
apps/web/src/components/whatsapp/
  whatsapp-official-panel.tsx                # UI Oficial (config, templates, eventos)
  whatsapp-provider-selector.tsx
  whatsapp-settings-shell.tsx
  whatsapp-settings-tabs.tsx
  no-autofill-field.tsx
apps/web/src/components/pagamentos/pagamentos-panel.tsx  # debug emailSent / whatsappSent
apps/web/src/components/settings/settings-sub-nav.tsx    # item WhatsApp
```

Prefixo HTTP da API: `API_PREFIX` (normalmente `/api/v1`). Paths abaixo são relativos a esse prefixo.

---

## 5. API HTTP

Acesso: JWT · `superadmin` · módulo `whatsapp` · **não** `master`.

| Método | Path | Função |
|--------|------|--------|
| GET | `/whatsapp-business/provider` | Provider activo |
| PATCH | `/whatsapp-business/provider` | `{ provider: "official" \| "generic" }` |
| GET | `/whatsapp-business/config` | Config pública (sem token) |
| PUT | `/whatsapp-business/config` | Guardar credenciais / portal / flags |
| GET | `/whatsapp-business/status` | Status do número na Graph |
| POST | `/whatsapp-business/messages/send` | Texto livre (`{ phone, message }`) |
| GET | `/whatsapp-business/templates` | Templates APPROVED |
| GET | `/whatsapp-business/templates/manage` | Todos os estados (gestão) |
| POST | `/whatsapp-business/templates` | Criar template (corpo texto) |
| DELETE | `/whatsapp-business/templates` | Apagar por `name` (+ `hsmId` opcional) |
| POST | `/whatsapp-business/templates/send` | Enviar template de teste |
| GET | `/whatsapp-business/templates/header-url` | URL media guardada |
| GET | `/whatsapp-business/notification-events` | 3 eventos + `headerMediaUrl` |
| PUT | `/whatsapp-business/notification-events/:eventKey` | Guardar flags + template + URL header |

Constantes cliente: `API_PATHS.whatsappBusiness` em `packages/shared/src/routes.ts`.

UI:

| Rota web | Componente |
|----------|------------|
| `/dashboard/settings/whatsapp` | redirect Oficial |
| `/dashboard/settings/whatsapp/oficial` | `WhatsappOfficialPanel` |
| `/dashboard/settings/whatsapp/generica` | `SettingsWhatsappPanel` (bridge) |

`WEB_ROUTES.dashboard.settings.whatsapp*` no mesmo `routes.ts`.

---

## 6. Base de dados

### 6.1 `whatsapp_business_configs`

PK = `tenant_id`.

| Coluna | Uso |
|--------|-----|
| `encrypted_access_token` | Token Graph, `encrypt()` com `ENCRYPTION_KEY` |
| `phone_number_id` | Destino `/messages` |
| `business_account_id` | Listar/criar templates |
| `api_version` | Ex. `v18.0` |
| `enabled` / `test_mode` | Flags |
| `portal_public_url` | Preview / sufixo botão dinâmico `{{1}}` |
| `template_header_urls` | JSON `{ "nome:pt_PT": "https://…" }` |

### 6.2 `whatsapp_business_notification_events`

PK composta `(tenant_id, event_key)`.

| Coluna | Uso |
|--------|-----|
| `email_enabled` / `whatsapp_enabled` | Canais |
| `whatsapp_template` / `whatsapp_language` | Template a usar |
| `config_data` | Reservado (não usado hoje) |

A URL do header **não** está nesta tabela: vive em `template_header_urls` da config, chave `templateName:language`.

### 6.3 `tenant_settings`

`key = whatsapp_active_provider` · `value = official | generic`.

### 6.4 `payment_reports` (debug)

| Coluna | Uso |
|--------|-----|
| `email_sent` | Email do relatório enviado neste confirm |
| `whatsapp_sent` | Template enviado neste confirm |
| `notification_debug` | `{ skipped: string[], errors: string[] }` |
| `last_sent_at` | Também actualizado pelo envio **manual** de email |

### 6.5 Módulo

Seed: `module_registry.key = whatsapp` (`20250610210000_sms_whatsapp_modules`).  
Activação: `tenant_modules` / `workspace_modules`.

---

## 7. Eventos e variáveis

Função única: `dispatchWhatsappBusinessEvent(tenantId, eventKey, targetUserId, context)`  
em `whatsapp-business.notifications.service.ts`.

| `eventKey` | Quando | Email | WhatsApp |
|------------|--------|-------|----------|
| `user_account_created_driver_admin` | `POST /users` com role motorista (`admin`) | Welcome SMTP se password auto | Template do evento |
| `user_account_created_manager_superadmin` | `POST /users` com role `superadmin` | Idem | Idem |
| `driver_weekly_payment_generated` | `POST /pagamentos/confirm` | `sendPaymentReportEmail` | Template do evento |

Constantes: `WHATSAPP_BUSINESS_EVENT_KEYS` / `WHATSAPP_BUSINESS_EVENT_META`.

### Mapa de variáveis (corpo do template)

O Graph recebe parâmetros **named** ou **numeric** conforme o template.

Sempre:

| Nome no template | Valor |
|------------------|--------|
| `driver_name`, `user_name`, `name`, `{{1}}` | Nome completo / username / email |
| `driver_email`, `user_email`, `email` | Email |
| `username` | Username |

Conta nova (se password auto-gerada):

| Nome | Valor |
|------|--------|
| `temporary_password`, `password`, `{{2}}` | Password temporária |
| `{{3}}` | Label da role |

Pagamento:

| Nome | Valor |
|------|--------|
| `inicio_semana`, `period_start`, `{{2}}` | Início (pt-PT longo) |
| `fim_semana`, `period_end`, `{{3}}` | Fim |
| `resultado_final`, `amount`, `{{4}}` | `€ x,xx` |

Se o template Meta usar **outro** nome (`{{semana}}`, etc.), há que o acrescentar em `buildContextMap()`.

Email de **criação de conta** só corre se a password foi **gerada automaticamente**. Password definida à mão → skip email (`Email: sem password temporária`).

---

## 8. Fluxo interno (resumo)

```
Evento de negócio
  → dispatchWhatsappBusinessEvent
      → lê whatsapp_business_notification_events
      → se emailEnabled: SMTP (welcome ou relatório)
      → se whatsappEnabled:
            provider === official
            config.enabled
            telefone no user
            lista templates APPROVED
            resolve parâmetros + header URL
            sendWhatsappBusinessTemplateMessage (Graph)
  → (pagamento) recordPaymentReportNotification
```

`testMode=true` → não chama Graph; o código trata como enviado (messageId `test_*`).

---

## 9. Como um programador acrescenta um evento novo

1. **Chave** em `WHATSAPP_BUSINESS_EVENT_KEYS` + título em `WHATSAPP_BUSINESS_EVENT_META` (`packages/shared/src/whatsapp-business.ts`).
2. **Default** em `DEFAULT_NOTIFICATION_EVENTS` (`whatsapp-business.config.service.ts`).
3. **Variáveis** em `buildContextMap()` (mesmo ficheiro de notifications).
4. **Hook** no sítio de negócio: `await dispatchWhatsappBusinessEvent(...)`. Falhas de WhatsApp **não** devem falhar a transacção (o pagamento já faz catch). Email SMTP em falta na criação de user **pode** devolver 400 (`EmailNotConfiguredError`).
5. Rebuild `@tvde/shared` + `@tvde/api`. A UI dos cartões lê `WHATSAPP_BUSINESS_EVENT_META` — o cartão novo aparece sozinho.
6. Template APPROVED na Meta com as mesmas variáveis; o gestor escolhe-o no painel.

---

## 10. Encriptação e env

| Variável | Uso |
|----------|-----|
| `ENCRYPTION_KEY` | AES do access token (obrigatório em produção) |
| `WEB_PUBLIC_URL` | Fallback de `portalPublicUrl` |
| `API_PREFIX` | Prefixo das rotas (ex. `/api/v1`) |

O token **não** vai para `.env` da frota: está na tabela, por tenant.

---

## 11. Troubleshooting

| Sintoma | Causa típica |
|---------|----------------|
| Cartão eventos: lista de templates vazia | Sem WABA, token inválido, ou nenhum APPROVED — «Actualizar templates» |
| `#131008 Required parameter is missing` | Variável named em falta (ex. `driver_email`) |
| Header IMAGE recusado / mensagem do TVDE a pedir URL | Sem URL em Eventos (ou URL inacessível à Meta) |
| WhatsApp desactivado no evento | Checkbox não gravado ou provider ≠ `official` |
| Utilizador sem telefone | `users.phone` vazio |
| Botão abre `app.tvde.one` | Template Meta com domínio antigo — criar template novo |
| `whatsappSent: false` no ver | Ler a linha de erro no mesmo modal |
| MASTER não acede | Intencional — só superadmin do tenant |
| Modo teste | Mensagens não chegam ao telemóvel |

Graph: `https://graph.facebook.com/{apiVersion}/{phoneNumberId}/messages`.

---

## 12. O que ainda não está

- Webhook inbound (receber mensagens / status de entrega) — coluna `webhook_verify_token` existe, rotas de callback **não**.
- Criar na UI templates com header **IMAGE** (só texto na Fase 1).
- Reescrever o domínio do botão URL já aprovado na Meta.
- Canal WhatsApp em **pagamentos em massa** (o modal ainda diz «será ligado»; o `POST /pagamentos/confirm` por motorista **já** dispara o evento).
- 2FA no provider Oficial (2FA WhatsApp fica na API Genérica).

---

## 13. Checklist de implementação noutro ambiente

1. `ENCRYPTION_KEY` no `.env`.
2. `npx prisma migrate deploy` (migrations §6).
3. Módulo `whatsapp` no seed / `tenant_modules`.
4. Build `@tvde/shared`, `@tvde/api`, `@tvde/web`.
5. `whatsappBusinessRoutes` registado em `apps/api/src/app.ts` (já está).
6. Superadmin: credenciais Meta + provider Oficial.
7. Templates APPROVED + URL header se IMAGE.
8. Eventos gravados.
9. Teste: criar motorista com telefone + password auto; confirmar pagamento e abrir **ver**.

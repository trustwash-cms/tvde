# WHMCS → Moloni (certificado)

Módulo independente na TVDE que **emite faturação certificada no Moloni** quando uma fatura fica **Paga** no WHMCS.

O plugin Moloni dentro do WHMCS **não deve ficar activo** em paralelo — causa duplicados e erros fiscais. A emissão certificada passa a ser exclusiva desta app.

## Fluxo

```
WHMCS (invoice Paid)
  → worker poll API WHMCS
  → cria rascunho local (Facturação)
  → issueInvoiceToMoloni (fatura-recibo)
  → espelho Gestão Administrativa (estado Pago)
  → email opcional (SMTP de facturação Moloni)
```

Reutiliza o mesmo caminho que Facturação / calendário / gestão administrativa (`createInvoice` → `issueInvoiceToMoloni` → `syncAdminMgmtFromBillingInvoice`).

## Criar credenciais API no WHMCS

Fontes oficiais: [API Credentials](https://docs.whmcs.com/9-0/system/authentication/api-credentials/) · [Access Control](https://developers.whmcs.com/api/access-control/) · [Security (API IP Access Restriction)](https://docs.whmcs.com/8-0-9/system/general-settings/general-settings-security/)

### 1) Role + credencial (Manage API Credentials)

1. Entrar no **WHMCS Admin**.
2. **Configuration (engrenagem) → System Settings → Manage API Credentials**  
   (em versões antigas: Setup → Staff Management → Manage API Credentials).
3. Separador **API Roles** → criar role (ex. `tvde.one`) com no mínimo:
   - `GetInvoices`
   - `GetInvoice`
   - `GetClientsDetails`
   - `GetClients` (painel Clientes)
   - `GetClientsProducts` (Serviços)
   - `GetClientsDomains` (Domínios)
   - `GetProducts` (catálogo Produtos)
   - Escrita (painel): `UpdateClient`, `SendEmail`, `AddInvoicePayment`, `UpdateInvoice`, `DeleteInvoice` (se a versão WHMCS o expuser; senão fallback Cancelled), `GetPaymentMethods`, `CreateInvoice` (client API pronto)
4. Separador **API Credentials** → **Generate New API Credential** → escolher o admin, descrição, role → **Generate**.
5. Guardar o **API Identifier** e o **API Secret** (o secret só aparece uma vez).

Nesta ecrã vês só a **tabela** (Identifier, Description, Admin User, Roles, Last Access).  
**Não há** item de topo “IP Access Control”. Editar a credencial (ícone Edit) só altera **descrição** e **roles** — não há campo Allowed IPs na credencial (docs oficiais).

### 2) Whitelist do IP (obrigatório — separado das credenciais)

A API externa é **restrita por IP por omissão**. Sem IP na lista → erro `Invalid IP …` mesmo com Identifier/Secret correctos e **Last Access: Never**.

1. **Configuration → System Settings → General Settings → separador Security**.
2. Secção **API IP Access Restriction**.
3. **Add IP** → colar o IP de origem das chamadas (ex. `46.189.137.161`) + nota (ex. `TVDE produção`) → adicionar.
4. **Save Changes**.

Na app (**Configurações → WHMCS**) o campo **IP de saída da API** mostra o IP público que o processo da API usa nas chamadas. Use esse valor (ou o IP reportado no erro `Invalid IP`) ao adicionar na whitelist. Após **Testar ligação**, a UI indica se a ligação OK ou se o IP está bloqueado, com os passos acima — **não** afirma que a app consegue adicionar o IP.

#### Porque a TVDE não gere a whitelist no WHMCS

Não tentamos escrever remotamente em General Settings / API IP Access Restriction:

1. **Chicken-egg** — se o IP actual não estiver na lista, a API WHMCS rejeita o pedido *antes* de qualquer alteração de settings.
2. **Sem API pública estável** — o WHMCS não expõe um endpoint documentado para editar essa lista.
3. **DB hacks fora de âmbito** — alterar `tblconfiguration` (ou equivalente) directamente não é suportado.

O master adiciona o IP no painel WHMCS; a TVDE só detecta e orienta.

Notas:

- Lista vazia = **ninguém** consegue chamar a API (daí o Invalid IP).
- Usa o IP **público de saída** da máquina que faz o POST a `/includes/api.php` (não o IP do Cloudflare Tunnel inbound).
- CIDR / ranges: a UI de Trusted Proxies aceita CIDR; para API IP Access Restriction, adiciona o IP exacto que o erro reporta.
- Alternativa se IP fixo não for viável: `$api_access_key` em `configuration.php` e passar `accesskey` em cada pedido ([Access Control](https://developers.whmcs.com/api/access-control/)). **Não** confundir com `$api_access_allowed_ips` (não documentado oficialmente).

### 3) Ligar na TVDE

1. URL da API (exemplo):
   ```
   https://teu-dominio.pt/includes/api.php
   ```
2. Na app: **Configurações → WHMCS** → colar URL, Identifier, Secret → **Guardar** → **Testar ligação**.
   - O secret fica encriptado na BD; **Testar ligação** reutiliza o secret guardado se o campo estiver vazio (não é preciso voltar a colá-lo).
3. Se o secret for ilegível (`ENCRYPTION_KEY` alterada), a UI pede para o colar de novo e guardar.

A TVDE autentica com os campos oficiais `identifier` + `secret` ([Authentication](https://developers.whmcs.com/api/authentication/)). Não envia `username`/`password` (isso seria login de admin com password em MD5) nem `accesskey` (isso é bypass opcional de IP em `configuration.php`).

### Authentication Failed — checklist

Se o teste passa do Invalid IP mas responde `Authentication Failed`:

1. Confirmar que colou o **API Identifier** e **API Secret** de Manage API Credentials — **não** o username/password do admin.
2. Admin associado à credencial está **activo**.
3. API Role atribuída à credencial inclui as acções de leitura listadas acima (credencial sem role = sem autorização).
4. Se o secret se perdeu: **Generate New API Credential**, apagar a antiga, colar o novo par na app e Guardar.
5. Confirmar que o IP de saída da API continua na whitelist (Security → API IP Access Restriction).

## Configuração na TVDE

| Campo | Descrição |
|--------|-----------|
| URL API | `…/includes/api.php` |
| Identifier / Secret | Credenciais WHMCS (secret encriptado com `ENCRYPTION_KEY`) |
| Emitir ao pagar | Activo = worker cria fatura-recibo Moloni |
| Enviar email | Usa SMTP/branding de **Configurações → Moloni → Email de faturas** |
| Poll | Worker interno ~60s (e cron HTTP opcional) |

Pré-requisitos:

- Módulo `whmcs` activo no workspace
- Módulo `billing` + Moloni ligado (empresa, série, categoria por defeito para linhas sem artigo)
- Gestão Administrativa: `syncFromMoloni` activo (e mark-paid-on-receipt se usares recibos)

## UI

- **Configurações → WHMCS** — credenciais + toggles + IP de saída
- **WHMCS** (subnav estilo Facturação):
  - **Consulta:** Clientes, Faturas (live), Serviços, Domínios, Produtos
  - Ficha de cliente: tabs + **editar perfil/notes** + **email**
  - Fatura: **Enviar email**, **Marcar paga**, **Cancelar** (sem apagar)
  - **Moloni → Mapa Moloni:** mapa local de pagas sincronizadas / emitidas / falhas + **Reprocessar**

## Checklist go-live

1. Desactivar plugin Moloni no WHMCS
2. Criar API credentials + whitelist IP em **General Settings → Security → API IP Access Restriction**
3. Activar módulo `whmcs` + configurar na app
4. Confirmar Moloni + categoria por defeito
5. Marcar 1 fatura de teste como Paga no WHMCS (ou esperar uma paga real)
6. Verificar emissão em Facturação e espelho em Gestão → Faturas (Pago)

## Fora de âmbito (fase seguinte)

- Webhook `InvoicePaid` (MVP emissão = poll)
- Emitir Moloni em Unpaid
- Playwright Finanças
- Apagar clientes; module commands (Create / Suspend / Terminate)
- UI de criar faturas WHMCS a partir da TVDE (API `CreateInvoice` já no client)
- Duplicar entidades

## Gestão de faturas no painel (live)

Em **WHMCS → Faturas** (`/dashboard/whmcs/faturas-whmcs`):

- Ver / Editar / Apagar por linha; checkboxes + bulk (marcar paga, não paga, cancelar, apagar)
- Detalhe: editar metadados + linhas; enviar email; marcar paga / não paga; cancelar; apagar

Endpoints (superadmin): `PUT/DELETE /whmcs/invoices/live/:id`, `POST .../mark-unpaid`, `POST /whmcs/invoices/live/bulk`.
`DeleteInvoice` não é oficial em todas as versões — se a API falhar com “function not found”, a app cancela a fatura.
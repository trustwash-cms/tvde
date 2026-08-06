# Moloni API — Referência para @tvde/billing

Documentação oficial: [Moloni Developers](https://www.moloni.pt/dev/visao-geral/)

**Base URL:** `https://api.moloni.pt/v1/`

Todos os pedidos à API (excepto OAuth) usam **POST** com `access_token` na query string.

**Importante:** com body JSON é obrigatório `&json=true` na query — sem isto a Moloni devolve `Forbidden` / «No company_id received». O `@tvde/billing` `MoloniClient` adiciona este parâmetro automaticamente.

---

## 1. Registo Developer (uma vez)

1. Conta em [moloni.pt](https://www.moloni.pt)
2. Activar API → obter **Developer ID** (`client_id`) e **Client Secret**
3. Definir **Redirect URI** (deve coincidir com o CMS) — **na API pública**, não no frontend:

```
# Produção tvde.one (colar exactamente no Moloni Developer):
https://api.tvde.one/api/v1/billing/moloni/callback
```

### Produção (api.tvde.one)

No `.env` da VM:

```env
NEXT_PUBLIC_API_PUBLIC_URL="https://api.tvde.one/api/v1"
NEXT_PUBLIC_MOLONI_REDIRECT_URI="https://api.tvde.one/api/v1/billing/moloni/callback"
API_PUBLIC_URL="https://api.tvde.one/api/v1"
```

O mesmo URI deve estar:

1. No painel Moloni Developer → **URI de Resposta**
2. Em **Configurações → Moloni** → campo Redirect URI (por workspace)
3. Em `billing_connections.redirect_uri` (gravado ao Guardar)

Não use URLs ngrok antigas nem `fleet.tvde.one` no callback.

### Desenvolvimento local — túnel obrigatório

A Moloni **não aceita** `localhost` nem `127.0.0.1` no Callback. Exponha a API (porta 3002) com um URL público HTTPS:

```bash
# Exemplo com ngrok
ngrok http 3002
```

No `.env` do CMS (só em dev):

```env
NEXT_PUBLIC_API_PUBLIC_URL="https://abc123.ngrok-free.app/api/v1"
# ou URI completo (tem prioridade):
NEXT_PUBLIC_MOLONI_REDIRECT_URI="https://abc123.ngrok-free.app/api/v1/billing/moloni/callback"
```

Reinicie o frontend (`npm run dev -w @tvde/web`). Em produção use sempre `api.tvde.one` (secção acima).

---

## 2. OAuth 2.0

Ref: [Autenticação](https://www.moloni.pt/dev/autenticacao/)

### 2.1 Autorizar utilizador

Redireccionar o browser para:

```
GET https://api.moloni.pt/v1/authorize/?response_type=code&client_id={DEVELOPER_ID}&redirect_uri={REDIRECT_URI}&state={STATE}
```

O utilizador autoriza na Moloni. Callback:

```
GET {redirect_uri}?code={AUTHORIZATION_CODE}&state={STATE}
```

### 2.2 Trocar code por tokens

```
GET https://api.moloni.pt/v1/grant/?grant_type=authorization_code
  &client_id={DEVELOPER_ID}
  &client_secret={CLIENT_SECRET}
  &redirect_uri={REDIRECT_URI}
  &code={AUTHORIZATION_CODE}
```

**Resposta:**

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600
}
```

Implementação: `src/providers/moloni/oauth.ts` → `exchangeAuthorizationCode()`

### 2.3 Refresh token

Antes de expirar:

```
GET https://api.moloni.pt/v1/grant/?grant_type=refresh_token
  &client_id={DEVELOPER_ID}
  &client_secret={CLIENT_SECRET}
  &refresh_token={REFRESH_TOKEN}
```

Implementação: `refreshAccessToken()`

---

## 3. Endpoints usados pelo CMS

### 3.1 Listar empresas

```
POST https://api.moloni.pt/v1/companies/getAll/?access_token={TOKEN}
Body: {}
```

Usado após OAuth para obter `company_id` automaticamente.

### 3.2 Clientes

**Procurar por NIF:**

```
POST .../customers/getByVat/?access_token={TOKEN}
Body: { "company_id": 123, "vat": "123456789" }
```

**Criar cliente:**

```
POST .../customers/insert/?access_token={TOKEN}
Body: {
  "company_id": 123,
  "name": "Cliente Lda",
  "vat": "123456789",
  "email": "",
  "phone": "",
  "address": "",
  "city": "",
  "zip_code": "",
  "country_id": 1
}
```

Ref: [customers/insert](https://www.moloni.pt/dev/entities/customers/insert/)

O CMS guarda `customer_id` em `billing_entities.external_id` (espelhado em `clients.external_customer_id`).

**Listar todos:**

```
POST .../customers/getAll/?access_token={TOKEN}
Body: { "company_id": 123, "offset": 0, "qty": 50 }
```

**Fornecedores:**

```
POST .../suppliers/getAll/?access_token={TOKEN}
POST .../suppliers/insert/?access_token={TOKEN}
```

**Catálogo:**

```
POST .../documentSets/getAll/?access_token={TOKEN}
POST .../taxes/getAll/?access_token={TOKEN}
```

### 3.3 Emitir documentos (por tipo)

| Tipo CMS | Endpoint Moloni |
|----------|-----------------|
| `invoice` | `invoices/insert` |
| `simplified_invoice` | `simplifiedInvoices/insert` |
| `invoice_receipt` | `invoiceReceipts/insert` |
| `debit_note` | `debitNotes/insert` |

**Listar documentos (sync pull):**

```
POST .../invoices/getAll/?access_token={TOKEN}
Body: { "company_id": 123, "offset": 0, "qty": 50 }
```

(análogo para `simplifiedInvoices/getAll`, etc.)

**Obter um documento (duplicação / detalhe):**

A Moloni **não tem** endpoint `duplicate`. O CMS usa `getOne` para ler artigos e metadata antes de criar rascunho local.

| Tipo CMS | Endpoint Moloni getOne |
|----------|------------------------|
| `invoice` | `invoices/getOne` |
| `simplified_invoice` | `simplifiedInvoices/getOne` |
| `invoice_receipt` | `invoiceReceipts/getOne` |
| `debit_note` | `debitNotes/getOne` |

```
POST .../invoices/getOne/?access_token={TOKEN}&json=true
Body: { "company_id": 123, "document_id": 789 }
```

Ref: [invoices/getOne](https://www.moloni.pt/dev/documents/invoices/getone/)

**Resposta relevante para duplicação:**

- `products[]` — `product_id`, `name`, `qty`, `price`, `taxes[]`, `exemption_reason`
- `document_set_id`, `your_reference`, `our_reference`, `notes`
- `financial_discount`, `special_discount`, campos de entrega
- `date`, `expiration_date` (data fiscal original — o CMS usa **hoje** no rascunho duplicado)

Implementação CMS: `MoloniClient.getDocument()` → `mapMoloniProductsToInvoiceLines()` + `metadataFromMoloniDocument()` em `map-invoice.ts`.

### 3.4 Emitir documentos (insert)

Linhas manuais no CMS: se não houver `product_id`, o CMS cria o artigo na categoria por defeito com a **Ref.ª Artigo** enviada em `productReference` (código curto do utilizador). **Não** gera referências do tipo `CMS-…` a partir da designação.

```
POST .../invoices/insert/?access_token={TOKEN}
```

Ref: [invoices/insert](https://www.moloni.pt/dev/documents/invoices/insert/)

**Body (exemplo):**

```json
{
  "company_id": 123,
  "customer_id": 456,
  "document_set_id": 1,
  "date": "2026-06-09",
  "expiration_date": "2026-07-09",
  "your_reference": "DRAFT-xxx",
  "notes": "",
  "status": 1,
  "products": [
    {
      "name": "Serviço de consultoria",
      "qty": 1,
      "price": 100.00,
      "tax_id": 1
    }
  ]
}
```

**Resposta (sucesso):**

```json
{
  "valid": 1,
  "document_id": 789,
  "number": "FT 2026/1"
}
```

Mapeamento CMS: `src/providers/moloni/map-invoice.ts`

| `status` | Significado |
|----------|-------------|
| `0` | Rascunho Moloni (editável) |
| `1` | Fechado / emitido (comunicação AT) |

O CMS emite sempre com `status: 1` via `issueInvoiceToMoloni`. Rascunhos duplicados ficam **no CMS** (`invoices.status=draft`) até o utilizador emitir — não se cria rascunho Moloni intermédio.

### 3.5 PDF de documentos

**Obter link (portal Moloni):**

```
POST .../documents/getPDFLink/?access_token={TOKEN}
Body: { "company_id": 123, "document_id": 789, "signed": 0 }
```

Ref: [documents/getPDFLink](https://www.moloni.pt/dev/documents/documents/getpdflink/)

**Resposta:**

```json
{ "url": "https://www.moloni.pt/downloads/?h=..." }
```

Só funciona para documentos **não rascunho** (`status != 0`).

**Download directo no CMS:**

O link devolvido abre uma página intermédia Moloni («Documento para descarregar»). O CMS converte para PDF binário em `pdf-download.ts`:

1. Extrai parâmetro `h` (hash/JWT desde 2025) da URL
2. Tenta `https://www.moloni.pt/downloads/index.php?action=getDownload&h=…&d=…`
3. Valida `Content-Type: application/pdf` ou magic bytes `%PDF`
4. Fallback: scrape HTML da página portal

Endpoint CMS: `GET /invoices/:id/pdf` → stream PDF ao browser.

**Assinatura:** parâmetro `signed: 1` em `getPDFLink` (desde Mar 2025).

---

## 4. Erros

- `valid: 0` no JSON → pedido rejeitado (ver `errors` / códigos)
- Consultar [Controlo de Erros](https://www.moloni.pt/dev/controlo-erros/) Moloni
- Classe `MoloniApiError` em `client.ts` expõe `status` e `body`

---

## 5. Sandbox / demonstração

Moloni oferece ambiente de testes — ver [Sandbox](https://www.moloni.pt/dev/sandbox/).

Para sandbox, altere `MOLONI_API_BASE` em `config.ts` se a URL for diferente.

**Empresa de Demonstração:** o CMS detecta modo demo pelo nome da empresa (`/demonstra/i`). Em **Configurações → Moloni** existe «Limpar dados do modo demonstração» (`POST /billing/moloni/purge-demo-data`) que apaga artefactos **locais** (documentos, tokens, cache de catálogo, entidades de facturação) — não apaga dados na cloud Moloni nem desliga o OAuth. Ver [FATURACAO.md §6.4.1](./FATURACAO.md).

---

## 6. Fluxo bidireccional no CMS

```
Moloni → CMS:
  POST /billing/sync/entities     → customers/getAll + suppliers/getAll
  POST /billing/sync/catalog      → documentSets + taxes
  POST /billing/sync/documents    → invoices/getAll (+ outros tipos)

CMS → Moloni:
  POST /billing/entities/:id/push → customers/insert | suppliers/insert
  POST /invoices/:id/issue        → endpoint por document_type

Ligação CRM:
  Match NIF → pending_confirm → POST /billing/entities/:id/confirm-link
  Conflitos → GET /billing/conflicts → POST .../resolve
```

Ver [ENTITIES.md](./ENTITIES.md) para o modelo completo.

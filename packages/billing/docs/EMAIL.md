# Email de faturas — branding e SMTP Moloni

O envio de faturas por email (emissão Moloni e **autofaturação do calendário**) usa branding + SMTP **do workspace de facturação**, isolados do SMTP e templates TVDE do sistema.

---

## 1. Onde configurar

**Configurações → Moloni** (`/dashboard/settings/moloni`) → secção **Email de faturas (Moloni)**

| Campo | Uso |
|--------|-----|
| Nome no cabeçalho | Marca no email (ex.: `projetox`) |
| Texto do rodapé / empresa | Copyright no rodapé (ex.: `Fatura123 Unip. LDA`) |
| Email de suporte | Link de contacto no corpo do email |
| SMTP (host, porta, user, pass, from, TLS) | Remetente da facturação (por workspace) |

Persistência: colunas `email_*` em `billing_connections` (1:1 com o workspace).

### Hierarquia SMTP (só emails de fatura)

1. **SMTP de facturação** do workspace (se host + user + password)
2. Fallback: SMTP do **tenant** → **plataforma** → **`.env`**

### Hierarquia da marca

1. `email_brand_name` / `email_footer_text` no Moloni
2. Nome da empresa Moloni ligada
3. `NEXT_PUBLIC_APP_NAME` (sistema)

Os emails de sistema (2FA, reset password, CarModule, etc.) **não** usam estas definições — continuam em **Configurações → SMTP**.

---

## 2. Template de faturas

| Propriedade | Valor |
|-------------|-------|
| Fonte | `apps/api/src/services/invoice-email-template.ts` |
| Isolamento | **Não** lê `email_templates` do tenant/plataforma para envio Moloni |
| Serviço | `sendBillingInvoiceTemplateEmail()` em `billing-email.service.ts` |

### Assunto por defeito

```
Fatura {{invoiceNumber}} — {{appName}}
```

(`appName` no rodapé = texto de rodapé / empresa; cabeçalho usa o nome da marca.)

### Variáveis

| Variável | Preenchimento |
|----------|----------------|
| `{{appName}}` | Rodapé / empresa (ou marca / fallback) |
| `{{appNamePrefix}}` / `{{appNameSuffix}}` | Cabeçalho a partir da marca |
| `{{recipientName}}` | Entidade fiscal ou CRM |
| `{{periodDescription}}` | Mês/ano da emissão |
| `{{invoiceNumber}}`, `{{issueDate}}`, `{{dueDate}}`, `{{total}}` | Dados da fatura |
| `{{downloadUrl}}` | Link público (página + download PDF) |
| `{{downloadExpiresIn}}` | Validade do link (default 90 dias) |
| `{{attachmentCta}}` | Texto do botão |
| `{{supportEmail}}` | Suporte facturação ou SMTP |
| `{{currentYear}}` | Ano actual |

---

## 3. Link público de download

Email → `GET /invoices/public/download-page?token=…` (HTML com botão) → `GET /invoices/public/download?token=…` (PDF).

| Regra | Valor |
|-------|--------|
| Validade | `INVOICE_DOWNLOAD_TOKEN_EXPIRES` (default `90d`) |
| Máx. downloads PDF | `INVOICE_DOWNLOAD_MAX_COUNT` (default `3`) |
| Contador | `invoice_download_tokens.download_count` — só incrementa no PDF, não na página HTML |
| Após limite | Página PT «Limite de downloads atingido» (sem stream do PDF) |

Refresh da página HTML **não** descarrega o PDF; só o clique no botão (com downloads restantes).

---

## 4. Fluxo de envio

```
POST /invoices/:id/send-email
  │  (também calendar autofatura → sendInvoiceEmail)
  ├─ Valida: emitida, external_id, email destinatário
  ├─ createInvoiceDownloadLink()
  ├─ resolve branding + SMTP de facturação (workspace)
  ├─ template invoice-email-template.ts (não email_templates do sistema)
  ├─ sendEmail(smtpOverride se SMTP Moloni)
  └─ UPDATE invoices SET email_sent_at = NOW()
```

**Destinatário:** `billing_entity.email` ?? `client.email` (calendário pode forçar `toEmail`).

---

## 5. API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/billing/moloni/email-config?workspaceId=` | Ler branding/SMTP (sem password) |
| PUT | `/billing/moloni/email-config` | Guardar branding/SMTP |
| POST | `/billing/moloni/email-test` | Teste SMTP de facturação `{ workspaceId, to }` |
| POST | `/invoices/:id/send-email` | Enviar fatura |

---

## 6. Código relevante

| Ficheiro | Função |
|----------|--------|
| `apps/api/src/services/billing-email.service.ts` | Branding, SMTP workspace, envio |
| `apps/api/src/services/billing.service.ts` | `sendInvoiceEmail()` |
| `apps/api/src/services/invoice-download-token.service.ts` | Token + limite de downloads |
| `apps/api/src/services/invoice-download-page.ts` | HTML público |
| `apps/web/src/components/moloni-billing-email-panel.tsx` | UI Moloni |

---

## 7. Checklist

- [ ] Marca + rodapé preenchidos em Configurações → Moloni
- [ ] SMTP de facturação testado («Enviar email de teste»)
- [ ] Reenviar fatura e confirmar cabeçalho/rodapé (não «TVDE.»)
- [ ] Abrir link «Descarregar fatura»: botão explícito; refresh não re-descarrega
- [ ] Após 3 downloads: mensagem de limite
- [ ] Autofatura calendário usa o mesmo branding/SMTP

# Email de faturas — SMTP e templates

O envio de faturas por email usa o SMTP configurado no CMS e um template HTML personalizável por tenant ou plataforma.

---

## 1. Onde configurar

**Configurações → SMTP** (`/dashboard/settings/smtp`)

| Secção | Conteúdo |
|--------|----------|
| SMTP | Host, porta, utilizador, password, TLS |
| Email de teste | Valida configuração |
| Templates de email | Separadores por tipo — ver [doc 17](../docs/17-email-transacional-templates.md) |

### Hierarquia SMTP

1. SMTP do **tenant** (se configurado e activo)
2. SMTP da **plataforma** (master)
3. Fallback **`.env`** (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, …)

---

## 2. Template de faturas

| Propriedade | Valor |
|-------------|-------|
| Chave interna | `invoice` |
| Ficheiro por defeito | `apps/api/src/services/invoice-email-template.ts` |
| Tabela override | `email_templates` (campo `key = 'invoice'`) |
| API edição | `PUT /email-templates/invoice` |

### Assunto por defeito

```
Fatura {{invoiceNumber}} — {{appName}}
```

### Variáveis disponíveis

| Variável | Preenchimento automático |
|----------|--------------------------|
| `{{appName}}` | `NEXT_PUBLIC_APP_NAME` ou `SMTP_FROM_NAME` |
| `{{appNamePrefix}}` | Parte antes do `.` em appName (ex.: `Empresa`) |
| `{{appNameSuffix}}` | Parte depois do `.` (ex.: `io`) |
| `{{recipientName}}` | Nome da entidade fiscal ou cliente CRM |
| `{{periodDescription}}` | Mês/ano da emissão (ex.: `maio de 2025`) |
| `{{invoiceNumber}}` | Número da fatura |
| `{{issueDate}}` | Data emissão (formato PT longo) |
| `{{dueDate}}` | Data vencimento ou `—` |
| `{{total}}` | Total formatado (ex.: `9,90 €`) |
| `{{attachmentNote}}` | Texto sobre PDF em anexo |
| `{{attachmentCta}}` | Texto do botão visual (ex.: `Descarregar fatura`) |
| `{{supportEmail}}` | Remetente SMTP |
| `{{currentYear}}` | Ano actual |
| `{{footerAddress}}` | Morada rodapé (vazio por defeito; editável no template) |

### Design do template

O template por defeito inclui:

- Cabeçalho escuro (`#1A1A2E`) com logo estilizado
- Caixa de resumo (número, datas, total em roxo `#534AB7`)
- Botão «Descarregar fatura» (visual — **PDF vai em anexo**, não é link público)
- Rodapé com copyright e email de suporte

**Nota:** valores CSS `var(--color-…)` do design original foram convertidos para cores hex fixas — clientes de email (Gmail, Outlook) não suportam variáveis CSS. Pode personalizar cores directamente no HTML.

---

## 3. Fluxo de envio

```
POST /invoices/:id/send-email
  │
  ├─ Valida: emitida, external_id, email destinatário
  ├─ downloadInvoicePdf() → bytes PDF Moloni
  ├─ getEmailTemplate(tenantId, 'invoice')
  ├─ renderTemplate(subject + htmlBody, variables)
  ├─ sendEmail({ html, attachments: [pdf] })
  └─ UPDATE invoices SET email_sent_at = NOW()
```

**Destinatário:**

```
billing_entity.email  ??  client.email
```

---

## 4. Interface — botão na lista de faturas

| Estado | Cor | Significado |
|--------|-----|-------------|
| Nunca enviado | Verde | Primeiro envio |
| Já enviado | Vermelho | Reenvio (pede confirmação) |
| Sem email | (oculto) | Entidade e CRM sem email |

Localização: coluna acções em **Documentos existentes** (`billing-document-panel.tsx`).

---

## 5. API

### Enviar email

```
POST /api/v1/invoices/:id/send-email
Authorization: Bearer {jwt}
```

**Resposta sucesso:**

```json
{
  "success": true,
  "data": { "id": "uuid", "emailSentAt": "2026-06-09T12:00:00.000Z" },
  "message": "Fatura enviada por email"
}
```

**Erros comuns:**

| HTTP | Mensagem | Causa |
|------|----------|-------|
| 400 | Cliente sem email | Entidade/CRM sem email |
| 400 | Rascunhos não podem ser enviados | `status=draft` |
| 503 | SMTP não configurado | Sem SMTP tenant/plataforma/env |

### Editar template

```
GET  /api/v1/email-templates
PUT  /api/v1/email-templates/invoice
```

Body PUT:

```json
{
  "subject": "Fatura {{invoiceNumber}} — {{appName}}",
  "htmlBody": "<!DOCTYPE html>..."
}
```

---

## 6. Audit

| Acção | Quando |
|-------|--------|
| `invoice.send_email` | Após envio bem-sucedido |

---

## Outros templates da plataforma

Códigos 2FA, confirmação eliminar tenant, reset password, calendário, CarModule: [docs/17-email-transacional-templates.md](../../docs/17-email-transacional-templates.md)

---

## 7. Código relevante

| Ficheiro | Função |
|----------|--------|
| `apps/api/src/services/billing.service.ts` | `sendInvoiceEmail()` |
| `apps/api/src/services/email.service.ts` | `sendTemplateEmail()`, `EMAIL_TEMPLATE_KEYS.invoice` |
| `apps/api/src/services/invoice-email-template.ts` | HTML por defeito |
| `apps/web/src/components/settings/settings-smtp-panel.tsx` | Editor UI |

---

## 8. Checklist produção

- [ ] SMTP tenant ou plataforma testado (botão «Enviar teste»)
- [ ] Template **Faturas** revisto (logo, cores, texto legal)
- [ ] `NEXT_PUBLIC_APP_NAME` correcto
- [ ] Entidades fiscais com **email** preenchido
- [ ] Moloni ligado (PDF obtido na emissão)

/** Template HTML por defeito para envio de faturas (editável em Configurações → SMTP). */
export const INVOICE_EMAIL_TEMPLATE = {
  subject: 'Fatura {{invoiceNumber}} — {{appName}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'recipientName',
    'periodDescription',
    'invoiceNumber',
    'issueDate',
    'dueDate',
    'total',
    'invoiceIntro',
    'downloadUrl',
    'downloadExpiresIn',
    'attachmentCta',
    'supportEmail',
    'currentYear',
    'footerAddress',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  .email-wrap { background: #f1f5f9; padding: 2rem; border-radius: 12px; }
  .email-card { background: #ffffff; border: 0.5px solid #e2e8f0; border-radius: 12px; max-width: 560px; margin: 0 auto; overflow: hidden; font-family: 'DM Sans', system-ui, sans-serif; }
  .email-header { background: #1A1A2E; padding: 2rem 2rem 1.5rem; text-align: center; }
  .email-header .logo { color: #fff; font-size: 20px; font-weight: 500; letter-spacing: 0.04em; }
  .email-header .logo span { color: #7F77DD; }
  .email-body { padding: 2rem; }
  .greeting { font-size: 15px; color: #0f172a; margin: 0 0 1rem; }
  .invoice-box { background: #f8fafc; border: 0.5px solid #e2e8f0; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0; }
  .invoice-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 5px 0; }
  .invoice-row .label { color: #64748b; }
  .invoice-row .value { color: #0f172a; font-weight: 500; }
  .invoice-row.total { border-top: 0.5px solid #e2e8f0; margin-top: 8px; padding-top: 12px; }
  .invoice-row.total .value { font-size: 17px; color: #534AB7; }
  .cta-wrap { text-align: center; margin: 2rem 0 1.5rem; }
  .btn-download { display: inline-flex; align-items: center; gap: 8px; background: #534AB7; color: #fff !important; font-size: 14px; font-weight: 500; padding: 12px 28px; border-radius: 8px; text-decoration: none; border: none; }
  .divider { height: 0.5px; background: #e2e8f0; margin: 1.5rem 0; }
  .note { font-size: 13px; color: #64748b; line-height: 1.6; margin: 0; }
  .email-footer { background: #f8fafc; border-top: 0.5px solid #e2e8f0; padding: 1.25rem 2rem; text-align: center; }
  .footer-text { font-size: 12px; color: #94a3b8; margin: 0; line-height: 1.6; }
  .badge { display: inline-block; background: #EEEDFE; color: #3C3489; font-size: 11px; font-weight: 500; padding: 2px 10px; border-radius: 20px; }
</style>
</head>
<body style="margin:0;padding:1rem;background:#f1f5f9;">
<div class="email-wrap">
  <div class="email-card">
    <div class="email-header">
      <div class="logo">{{appNamePrefix}}<span>.</span>{{appNameSuffix}}</div>
      <p style="color:#9999bb; font-size:12px; margin:6px 0 0;">Fatura disponível para download</p>
    </div>
    <div class="email-body">
      <p class="greeting">Olá, <strong>{{recipientName}}</strong>,</p>
      <p class="note">A sua fatura referente ao mês de <strong>{{periodDescription}}</strong> já está disponível. {{invoiceIntro}}</p>

      <div class="invoice-box">
        <div class="invoice-row">
          <span class="label">Número de fatura</span>
          <span class="value"><span class="badge">{{invoiceNumber}}</span></span>
        </div>
        <div class="invoice-row">
          <span class="label">Data de emissão</span>
          <span class="value">{{issueDate}}</span>
        </div>
        <div class="invoice-row">
          <span class="label">Data de vencimento</span>
          <span class="value">{{dueDate}}</span>
        </div>
        <div class="invoice-row total">
          <span class="label" style="font-weight:500; color:#0f172a">Total a pagar</span>
          <span class="value">{{total}}</span>
        </div>
      </div>

      <div class="cta-wrap">
        <a href="{{downloadUrl}}" class="btn-download" target="_blank" rel="noopener noreferrer">↓ {{attachmentCta}}</a>
      </div>
      <p class="note" style="text-align:center;font-size:12px;">O link de download é válido por {{downloadExpiresIn}}. Após expirar, solicite uma nova cópia à nossa equipa.</p>

      <div class="divider"></div>
      <p class="note">Se tiver alguma dúvida sobre esta fatura, não hesite em contactar a nossa equipa de apoio ao cliente em <a href="mailto:{{supportEmail}}" style="color:#534AB7; text-decoration:none;">{{supportEmail}}</a>.</p>
    </div>
    <div class="email-footer">
      <p class="footer-text">© {{currentYear}} {{appName}}{{footerAddress}}</p>
    </div>
  </div>
</div>
</body>
</html>`,
};

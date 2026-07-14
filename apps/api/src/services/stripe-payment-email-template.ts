export const STRIPE_PAYMENT_EMAIL_TEMPLATE = {
  subject: 'Pagamento: {{description}} — {{companyName}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'companyName',
    'companyLogoHtml',
    'recipientName',
    'description',
    'amount',
    'sourceLabel',
    'paymentUrl',
    'paymentButtonHtml',
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
  .payment-box { background: #f8fafc; border: 0.5px solid #e2e8f0; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0; }
  .payment-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 5px 0; }
  .payment-row .label { color: #64748b; }
  .payment-row .value { color: #0f172a; font-weight: 500; }
  .payment-row.total { border-top: 0.5px solid #e2e8f0; margin-top: 8px; padding-top: 12px; }
  .payment-row.total .value { font-size: 17px; color: #534AB7; }
  .cta-wrap { text-align: center; margin: 2rem 0 1.5rem; }
  .btn-pay { display: inline-block; background: #534AB7; color: #fff !important; font-size: 14px; font-weight: 500; padding: 12px 28px; border-radius: 8px; text-decoration: none; }
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
      <div class="logo">{{companyLogoHtml}}</div>
      <p style="color:#9999bb; font-size:12px; margin:6px 0 0;">Pedido de pagamento</p>
    </div>
    <div class="email-body">
      <p class="greeting">Olá, <strong>{{recipientName}}</strong>,</p>
      <p class="note">Segue o pedido de pagamento{{sourceLabel}}. Pode pagar com cartão, Klarna ou MB Way (conforme activos na conta Stripe).</p>

      <div class="payment-box">
        <div class="payment-row">
          <span class="label">Descrição</span>
          <span class="value">{{description}}</span>
        </div>
        <div class="payment-row total">
          <span class="label" style="font-weight:500; color:#0f172a">Valor</span>
          <span class="value">{{amount}}</span>
        </div>
      </div>

      <div class="cta-wrap">
        {{paymentButtonHtml}}
      </div>

      <div class="divider"></div>
      <p class="note">Se tiver dúvidas, contacte <a href="mailto:{{supportEmail}}" style="color:#534AB7; text-decoration:none;">{{supportEmail}}</a>.</p>
      <p class="note" style="margin-top:12px;font-size:12px;word-break:break-all;">{{paymentUrl}}</p>
    </div>
    <div class="email-footer">
      <p class="footer-text">© {{currentYear}} {{appName}}{{footerAddress}}</p>
    </div>
  </div>
</div>
</body>
</html>`,
};

export function buildStripePaymentButtonHtml(paymentUrl: string, label = 'Pagar agora'): string {
  return `<a href="${paymentUrl}" class="btn-pay">${label}</a>`;
}

export function buildStripePaymentCtaBlock(paymentUrl: string): string {
  return `<div style="text-align:center;margin:24px 0 8px;">
    <p style="font-size:14px;color:#334155;margin:0 0 12px;">Quer pagar esta folha de obra?</p>
    <a href="${paymentUrl}" style="display:inline-block;background:#534AB7;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;">Pagar agora</a>
  </div>`;
}

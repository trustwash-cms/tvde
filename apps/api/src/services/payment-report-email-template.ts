/**
 * Template de email do relatório de pagamento.
 *
 * Visual alinhado com invoice / stripe / welcome (header #1A1A2E, CTA #534AB7,
 * border-radius 8px). Conteúdo no espírito do legado (período, cards, conta
 * corrente, valor final, área de cliente).
 *
 * Conta corrente: {{contaCorrenteDetailsHtml}} só quando há movimentos.
 * Contacto no rodapé: {{supportEmail}} = email da frota/empresa.
 */
export const PAYMENT_REPORT_EMAIL_TEMPLATE = {
  subject: 'Relatório de pagamento {{periodStart}} – {{periodEnd}} — {{companyName}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'companyName',
    'companyEmail',
    'companyLogoHtml',
    'driverName',
    'periodStart',
    'periodEnd',
    'cardsHtml',
    'contaCorrenteDetailsHtml',
    'totalValue',
    'totalColor',
    'portalLoginUrl',
    'portalLoginButtonHtml',
    'supportEmail',
    'currentYear',
    'footerAddress',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Relatório de pagamento</title>
<style>
  .email-wrap { background: #f1f5f9; padding: 2rem; border-radius: 12px; }
  .email-card { background: #ffffff; border: 0.5px solid #e2e8f0; border-radius: 12px; max-width: 560px; margin: 0 auto; overflow: hidden; font-family: 'DM Sans', system-ui, sans-serif; }
  .email-header { background: #1A1A2E; padding: 2rem 2rem 1.5rem; text-align: center; }
  .email-header .logo { color: #fff; font-size: 20px; font-weight: 500; letter-spacing: 0.04em; }
  .email-body { padding: 2rem; }
  .greeting { font-size: 15px; color: #0f172a; margin: 0 0 0.5rem; }
  .note { font-size: 13px; color: #64748b; line-height: 1.6; margin: 0; }
  .period-box { background: #f8fafc; border: 0.5px solid #e2e8f0; border-radius: 8px; padding: 1rem 1.25rem; margin: 1.25rem 0; text-align: center; }
  .cta-wrap { text-align: center; margin: 1.75rem 0 1.25rem; }
  .btn-portal { display: inline-block; background: #534AB7; color: #fff !important; font-size: 14px; font-weight: 500; padding: 12px 28px; border-radius: 8px; text-decoration: none; }
  .divider { height: 0.5px; background: #e2e8f0; margin: 1.5rem 0; }
  .email-footer { background: #1A1A2E; padding: 1.25rem 2rem; text-align: center; }
  .footer-text { font-size: 12px; color: #9999bb; margin: 0; line-height: 1.6; }
</style>
</head>
<body style="margin:0;padding:1rem;background:#f1f5f9;">
<div class="email-wrap">
  <div class="email-card">
    <div class="email-header">
      <div class="logo">{{companyLogoHtml}}</div>
      <p style="color:#9999bb; font-size:12px; margin:6px 0 0;">Relatório de pagamento</p>
    </div>
    <div class="email-body">
      <p class="greeting">Olá, <strong>{{driverName}}</strong>,</p>
      <p class="note">O valor a receber do período é:</p>

      <div class="period-box">
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">Período</p>
        <p style="margin:0;font-size:17px;font-weight:600;color:#0f172a;">{{periodStart}} a {{periodEnd}}</p>
      </div>

      {{cardsHtml}}

      {{contaCorrenteDetailsHtml}}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;background:#f8fafc;border:0.5px solid #e2e8f0;border-radius:8px;">
        <tr>
          <td align="center" style="padding:18px 16px;">
            <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Valor final</p>
            <p style="margin:0;font-size:26px;font-weight:700;color:{{totalColor}};">{{totalValue}}</p>
          </td>
        </tr>
      </table>

      {{portalLoginButtonHtml}}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;background:#fffbeb;border:0.5px solid #f59e0b;border-radius:8px;">
        <tr>
          <td style="padding:12px 14px;">
            <p style="margin:0;font-size:12px;color:#92400e;line-height:1.55;text-align:center;">
              Caso exista alguma discrepância nos valores apresentados, por favor contacte-nos através dos canais abaixo.
            </p>
          </td>
        </tr>
      </table>

      <div class="divider"></div>
      <p class="note">Dúvidas? Contacte <a href="mailto:{{supportEmail}}" style="color:#534AB7;text-decoration:none;">{{supportEmail}}</a>.</p>
    </div>
    <div class="email-footer">
      <p class="footer-text">© {{currentYear}} {{companyName}}{{footerAddress}}</p>
      <p class="footer-text" style="margin-top:6px;">
        <a href="mailto:{{supportEmail}}" style="color:#c4c4dd;text-decoration:none;">{{supportEmail}}</a>
      </p>
    </div>
  </div>
</div>
</body>
</html>`,
};

/**
 * Email interno — IVA 6% sobre receitas de corridas (superadmin).
 * Visual alinhado com payment_report / invoice.
 */
export const PAYMENT_REPORT_IVA6_EMAIL_TEMPLATE = {
  subject:
    'IVA 6% receitas {{periodStart}} – {{periodEnd}} — {{driverName}} — {{companyName}}',
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
    'receitasTotal',
    'ivaAmount',
    'diferencaAmount',
    'resultadoLabel',
    'resultadoAmount',
    'supportEmail',
    'currentYear',
    'footerAddress',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>IVA 6% receitas</title>
<style>
  .email-wrap { background: #f1f5f9; padding: 2rem; border-radius: 12px; }
  .email-card { background: #ffffff; border: 0.5px solid #e2e8f0; border-radius: 12px; max-width: 560px; margin: 0 auto; overflow: hidden; font-family: 'DM Sans', system-ui, sans-serif; }
  .email-header { background: #1A1A2E; padding: 2rem 2rem 1.5rem; text-align: center; }
  .email-header .logo { color: #fff; font-size: 20px; font-weight: 500; letter-spacing: 0.04em; }
  .email-body { padding: 2rem; }
  .greeting { font-size: 15px; color: #0f172a; margin: 0 0 0.5rem; }
  .note { font-size: 13px; color: #64748b; line-height: 1.6; margin: 0; }
  .period-box { background: #f8fafc; border: 0.5px solid #e2e8f0; border-radius: 8px; padding: 1rem 1.25rem; margin: 1.25rem 0; text-align: center; }
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
      <p style="color:#9999bb; font-size:12px; margin:6px 0 0;">IVA 6% sobre receitas</p>
    </div>
    <div class="email-body">
      <p class="greeting">Relatório fiscal — <strong>{{driverName}}</strong></p>
      <p class="note">Valores calculados sobre o total de receitas (corridas) do período indicado.</p>

      <div class="period-box">
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">Período</p>
        <p style="margin:0;font-size:17px;font-weight:600;color:#0f172a;">{{periodStart}} a {{periodEnd}}</p>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
        <tr>
          <td width="50%" valign="top" style="padding:6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:0.5px solid #e2e8f0;border-radius:8px;">
              <tr>
                <td style="padding:14px 10px;text-align:center;">
                  <p style="margin:0;font-size:11px;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">Receitas (corridas)</p>
                  <p style="margin:8px 0 0;font-size:18px;font-weight:600;color:#0f172a;">{{receitasTotal}}</p>
                </td>
              </tr>
            </table>
          </td>
          <td width="50%" valign="top" style="padding:6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:0.5px solid #e2e8f0;border-radius:8px;">
              <tr>
                <td style="padding:14px 10px;text-align:center;">
                  <p style="margin:0;font-size:11px;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">IVA 6%</p>
                  <p style="margin:8px 0 0;font-size:18px;font-weight:600;color:#dc2626;">{{ivaAmount}}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;background:#f8fafc;border:0.5px solid #e2e8f0;border-radius:8px;">
        <tr>
          <td align="center" style="padding:18px 16px;">
            <p style="margin:0 0 6px;font-size:13px;color:#64748b;">{{resultadoLabel}}</p>
            <p style="margin:0;font-size:26px;font-weight:700;color:#166534;">{{resultadoAmount}}</p>
          </td>
        </tr>
      </table>

      <div class="divider"></div>
      <p class="note">Documento interno — o motorista não recebe esta comunicação.</p>
      <p class="note" style="margin-top:8px;">Dúvidas? Contacte <a href="mailto:{{supportEmail}}" style="color:#534AB7;text-decoration:none;">{{supportEmail}}</a>.</p>
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

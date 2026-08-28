export const CALENDAR_APPOINTMENT_TEMPLATE = {
  subject: 'Compromisso confirmado — {{eventTitle}}',
  variables: [
    'eventTitle',
    'eventSummary',
    'monthAbbr',
    'day',
    'startAt',
    'endAt',
    'location',
    'locationMap',
    'guests',
    'year',
    'companyName',
    'companyAddress',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agendamento confirmado</title>
</head>
<body style="margin:0;padding:24px 16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A2E;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <!-- Header escuro (sem fundo verde) -->
          <tr>
            <td align="center" style="background:#1A1A2E;padding:36px 32px 28px;">
              <!-- Ícone calendário (estilo anexo: topo vermelho + face branca) -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px;">
                <tr>
                  <td align="center" style="background:#D94F3A;border-radius:14px;padding:10px 10px 12px;width:120px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="padding:0 18px 6px;">
                          <span style="display:inline-block;width:14px;height:22px;background:#2C2C2C;border-radius:4px;margin:0 10px;"></span>
                          <span style="display:inline-block;width:14px;height:22px;background:#2C2C2C;border-radius:4px;margin:0 10px;"></span>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="background:#ffffff;border-radius:8px;padding:10px 8px 12px;">
                          <div style="font-size:15px;font-weight:500;color:#9CA3AF;letter-spacing:0.02em;text-transform:capitalize;">{{monthAbbr}}</div>
                          <div style="font-size:48px;font-weight:700;color:#1A1A2E;line-height:1.05;">{{day}}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">{{eventTitle}}</h1>
              <p style="margin:0;color:#9999bb;font-size:14px;line-height:1.6;">{{eventSummary}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 36px 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E2EB;border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #F0F0F0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="40" valign="top">
                          <div style="width:32px;height:32px;border-radius:8px;background:#EEF2FF;text-align:center;line-height:32px;font-size:15px;">&#128336;</div>
                        </td>
                        <td valign="top">
                          <div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:2px;">Data &amp; hora</div>
                          <div style="font-size:14px;font-weight:500;color:#1A1A2E;line-height:1.5;">{{startAt}} &rarr; {{endAt}}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #F0F0F0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="40" valign="top">
                          <div style="width:32px;height:32px;border-radius:8px;background:#EEF2FF;text-align:center;line-height:32px;font-size:15px;">&#128205;</div>
                        </td>
                        <td valign="top">
                          <div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:2px;">Morada</div>
                          <div style="font-size:14px;font-weight:500;color:#1A1A2E;line-height:1.5;">{{location}}</div>
                          {{locationMap}}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="40" valign="top">
                          <div style="width:32px;height:32px;border-radius:8px;background:#EEF2FF;text-align:center;line-height:32px;font-size:15px;">&#128101;</div>
                        </td>
                        <td valign="top">
                          <div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:2px;">Convidados</div>
                          <div style="font-size:14px;font-weight:500;color:#1A1A2E;line-height:1.5;">{{guests}}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="background:#1A1A2E;padding:18px 32px;">
              <p style="margin:0;font-size:12px;color:#9999bb;line-height:1.6;">&copy; {{year}} {{companyName}}{{companyAddress}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
} as const;

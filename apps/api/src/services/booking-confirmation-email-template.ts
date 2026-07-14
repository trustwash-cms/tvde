export const BOOKING_CONFIRMATION_TEMPLATE = {
  subject: 'Marcação confirmada — {{serviceName}}',
  variables: [
    'guestName',
    'serviceName',
    'servicePrice',
    'monthAbbr',
    'day',
    'startAt',
    'endAt',
    'companyName',
    'year',
    'cancelUrl',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Marcação confirmada</title>
  <style>
    body {
      margin: 0;
      padding: 32px 16px;
      background: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #18181b;
    }
    .wrap {
      max-width: 520px;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e4e4e7;
    }
    .hero {
      background: #6366f1;
      color: #fff;
      padding: 32px 28px;
      text-align: center;
    }
    .hero h1 { margin: 0 0 8px; font-size: 22px; }
    .hero p { margin: 0; opacity: 0.9; font-size: 14px; line-height: 1.5; }
    .body { padding: 28px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid #f4f4f5;
      font-size: 14px;
    }
    .row:last-child { border-bottom: none; }
    .label { color: #71717a; }
    .value { font-weight: 600; text-align: right; }
    .footer {
      padding: 16px 28px 24px;
      text-align: center;
      font-size: 12px;
      color: #a1a1aa;
      background: #fafafa;
    }
    .cancel {
      padding: 0 28px 24px;
      text-align: center;
    }
    .cancel a {
      display: inline-block;
      padding: 12px 20px;
      border-radius: 8px;
      border: 1px solid #e4e4e7;
      color: #52525b;
      font-size: 14px;
      text-decoration: none;
    }
    .cancel p {
      margin: 12px 0 0;
      font-size: 12px;
      color: #a1a1aa;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>Marcação confirmada</h1>
      <p>Olá {{guestName}}, a sua marcação foi registada com sucesso.</p>
    </div>
    <div class="body">
      <div class="row"><span class="label">Serviço</span><span class="value">{{serviceName}}</span></div>
      <div class="row"><span class="label">Preço</span><span class="value">{{servicePrice}}</span></div>
      <div class="row"><span class="label">Data</span><span class="value">{{day}} {{monthAbbr}}</span></div>
      <div class="row"><span class="label">Horário</span><span class="value">{{startAt}} – {{endAt}}</span></div>
    </div>
    <div class="cancel">
      <a href="{{cancelUrl}}">Cancelar marcação</a>
      <p>Se não puder comparecer, use este link pessoal para cancelar.</p>
    </div>
    <div class="footer">&copy; {{year}} {{companyName}}</div>
  </div>
</body>
</html>`,
} as const;

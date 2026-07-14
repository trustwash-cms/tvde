export const CARWASH_COMPLETION_TEMPLATE = {
  subject: 'Serviço concluído — {{workSheetReference}} · {{companyName}}',
  variables: [
    'appName',
    'companyName',
    'companyLogoHtml',
    'customerName',
    'customerEmail',
    'customerPhone',
    'customerVat',
    'workSheetReference',
    'workSheetTitle',
    'workSheetStatus',
    'completedAt',
    'vehicleLabel',
    'vehicleNotes',
    'linesHtml',
    'totalAmount',
    'paymentMethodLabel',
    'paymentCtaHtml',
    'notes',
    'signatureHtml',
    'photosHtml',
    'year',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Serviço concluído</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 32px 16px;
      color: #0f172a;
    }
    .wrap {
      max-width: 620px;
      margin: 0 auto;
      background: #fff;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
    }
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
      padding: 32px 28px 28px;
      text-align: center;
      color: #fff;
    }
    .logo { margin-bottom: 16px; }
    .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .header p { font-size: 14px; opacity: 0.9; }
    .body { padding: 28px; }
    .badge {
      display: inline-block;
      background: #ecfdf5;
      color: #047857;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 16px;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px;
    }
    .card label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; margin-bottom: 4px; }
    .card span { font-size: 14px; font-weight: 600; color: #0f172a; }
    table.lines { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    table.lines th { text-align: left; padding: 10px 8px; border-bottom: 2px solid #e2e8f0; color: #64748b; font-weight: 600; }
    table.lines td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }
    .total-row { text-align: right; font-size: 18px; font-weight: 700; padding-top: 12px; }
    .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .photos img { width: 140px; height: 100px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0; }
    .notes { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px; font-size: 13px; color: #92400e; margin-top: 16px; }
    .footer { padding: 20px 28px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
    @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="logo">{{companyLogoHtml}}</div>
      <h1>Serviço concluído</h1>
      <p>{{workSheetReference}} · {{workSheetTitle}}</p>
    </div>
    <div class="body">
      <span class="badge">Concluída em {{completedAt}}</span>
      <p style="font-size:15px;margin-bottom:18px;">Olá <strong>{{customerName}}</strong>, o trabalho no seu veículo foi concluído. Segue o resumo:</p>
      <div class="grid">
        <div class="card"><label>Cliente</label><span>{{customerName}}</span></div>
        <div class="card"><label>Contacto</label><span>{{customerPhone}}</span></div>
        <div class="card"><label>Email</label><span>{{customerEmail}}</span></div>
        <div class="card"><label>NIF</label><span>{{customerVat}}</span></div>
        <div class="card" style="grid-column:1/-1"><label>Veículo</label><span>{{vehicleLabel}}</span></div>
      </div>
      <h3 style="font-size:14px;margin-bottom:8px;">Linhas de trabalho</h3>
      {{linesHtml}}
      <div class="total-row">Total s/ IVA: {{totalAmount}}</div>
      {{paymentMethodLabel}}
      {{paymentCtaHtml}}
      {{notes}}
      {{photosHtml}}
      {{signatureHtml}}
    </div>
    <div class="footer">&copy; {{year}} {{companyName}} · {{appName}}</div>
  </div>
</body>
</html>`,
};

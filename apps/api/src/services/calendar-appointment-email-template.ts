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
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #F0F0F0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 40px 16px;
      color: #1A1A2E;
    }
    .email-wrapper {
      max-width: 580px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #DEDEDE;
    }
    .hero {
      background-color: #52BB7E;
      padding: 48px 40px 44px;
      text-align: center;
    }
    .cal-outer {
      display: inline-block;
      width: 120px;
      background: #D94F3A;
      border-radius: 14px;
      padding: 0 0 10px;
      margin-bottom: 28px;
    }
    .cal-rings {
      display: flex;
      justify-content: space-around;
      padding: 0 24px;
      position: relative;
      top: -8px;
    }
    .cal-ring { width: 18px; height: 28px; background: #2C2C2C; border-radius: 4px; }
    .cal-face {
      background: #ffffff;
      margin: 0 8px;
      border-radius: 6px;
      padding: 10px 8px 14px;
      text-align: center;
    }
    .cal-month { font-size: 16px; font-weight: 400; color: #AAAAAA; letter-spacing: 0.02em; }
    .cal-day   { font-size: 52px; font-weight: 700; color: #1A1A2E; line-height: 1.1; }
    .hero h1   { color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .hero p    { color: rgba(255,255,255,0.85); font-size: 14px; line-height: 1.6; }
    .email-body { padding: 36px 40px 40px; }
    .event-box {
      border: 1px solid #E2E2EB;
      border-radius: 10px;
      overflow: hidden;
    }
    .event-row {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 13px 20px;
      border-bottom: 0.5px solid #F0F0F0;
      font-size: 14px;
    }
    .event-row:last-child { border-bottom: none; }
    .event-row .icon {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #EAF3DE;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #3B6D11;
      font-size: 16px;
      margin-top: 1px;
    }
    .event-row .info { flex: 1; min-width: 0; }
    .event-row .info .row-label {
      font-size: 11px;
      color: #AAAAAB;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .event-row .info .row-value {
      color: #1A1A2E;
      font-weight: 500;
      line-height: 1.5;
    }
    .email-footer {
      background: #F7F7F9;
      border-top: 1px solid #EBEBEB;
      padding: 18px 40px;
      text-align: center;
    }
    .footer-text { font-size: 12px; color: #AAAAAB; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="hero">
      <div class="cal-outer">
        <div class="cal-rings">
          <div class="cal-ring"></div>
          <div class="cal-ring"></div>
        </div>
        <div class="cal-face">
          <div class="cal-month">{{monthAbbr}}</div>
          <div class="cal-day">{{day}}</div>
        </div>
      </div>
      <h1>{{eventTitle}}</h1>
      <p>{{eventSummary}}</p>
    </div>
    <div class="email-body">
      <div class="event-box">
        <div class="event-row">
          <div class="icon">&#128336;</div>
          <div class="info">
            <div class="row-label">Data &amp; hora</div>
            <div class="row-value">{{startAt}} &rarr; {{endAt}}</div>
          </div>
        </div>
        <div class="event-row">
          <div class="icon">&#128205;</div>
          <div class="info">
            <div class="row-label">Morada</div>
            <div class="row-value">{{location}}</div>
            {{locationMap}}
          </div>
        </div>
        <div class="event-row">
          <div class="icon">&#128101;</div>
          <div class="info">
            <div class="row-label">Convidados</div>
            <div class="row-value">{{guests}}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="email-footer">
      <p class="footer-text">&copy; {{year}} {{companyName}}{{companyAddress}}</p>
    </div>
  </div>
</body>
</html>`,
} as const;

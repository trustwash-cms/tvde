import { EMAIL_DESIGN_STYLE } from './email-design-tokens';

export const USER_DELETE_CONFIRMATION_EMAIL_TEMPLATE = {
  subject: 'Confirmação — eliminar utilizador {{targetUsername}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'targetUsername',
    'targetEmail',
    'confirmationCode',
    'expiresInMinutes',
    'supportEmail',
    'currentYear',
    'footerAddress',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${EMAIL_DESIGN_STYLE}
</head>
<body style="margin:0;padding:0;background:var(--color-background-secondary);">
<div style="background: var(--color-background-secondary); padding: 1.5rem; border-radius: var(--border-radius-lg);">
  <div style="background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); max-width: 560px; margin: 0 auto; overflow: hidden; font-family: var(--font-sans);">
    <div style="padding: 2rem;">
      <p style="font-size: 15px; color: var(--color-text-primary); margin: 0 0 1rem;">Confirmação de eliminação</p>
      <p style="font-size: 14px; color: var(--color-text-secondary); line-height: 1.6; margin: 0 0 1.5rem;">
        Pediu eliminar o utilizador <strong>{{targetUsername}}</strong> ({{targetEmail}}).
        Introduza o código abaixo na aplicação para confirmar. Válido {{expiresInMinutes}} minutos.
      </p>
      <div style="text-align: center; margin: 0 0 1.5rem;">
        <div style="display: inline-block; background: #FEE2E2; border: 0.5px solid #FCA5A5; border-radius: var(--border-radius-md); padding: 1rem 2rem;">
          <span style="font-size: 24px; font-weight: 600; letter-spacing: 0.2em; color: #991B1B; font-family: var(--font-mono);">{{confirmationCode}}</span>
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`,
};

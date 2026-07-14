import { EMAIL_DESIGN_STYLE } from './email-design-tokens';

export const CARWASH_ACTION_CONFIRMATION_EMAIL_TEMPLATE = {
  subject: 'Código para {{actionLabel}} — {{workSheetReference}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'actionLabel',
    'workSheetReference',
    'workSheetTitle',
    'confirmationCode',
    'expiresIn',
    'supportEmail',
    'currentYear',
    'footerAddress',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  ${EMAIL_DESIGN_STYLE}
</head>
<body style="margin:0;padding:0;background:var(--color-background-secondary);">
<div style="background: var(--color-background-secondary); padding: 1.5rem;">
  <div style="background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); max-width: 560px; margin: 0 auto; padding: 2rem; font-family: var(--font-sans);">
    <p style="font-size: 15px; color: var(--color-text-primary); margin: 0 0 1rem;">Confirmação de acção na folha de obra</p>
    <p style="font-size: 14px; color: var(--color-text-secondary); line-height: 1.6;">
      Foi solicitada a acção <strong>{{actionLabel}}</strong> na folha <strong>{{workSheetReference}}</strong> ({{workSheetTitle}}).
    </p>
    <p style="font-size: 13px; color: var(--color-text-secondary); margin: 1.5rem 0 0.75rem;">O seu código de confirmação:</p>
    <p style="font-size: 28px; font-weight: 700; letter-spacing: 0.2em; font-family: var(--font-mono); color: var(--color-text-primary); margin: 0 0 1rem;">{{confirmationCode}}</p>
    <p style="font-size: 12px; color: var(--color-text-secondary);">Expira em {{expiresIn}} minutos.</p>
  </div>
</div>
</body>
</html>`,
};

export const CARWASH_ACTION_REQUEST_EMAIL_TEMPLATE = {
  subject: 'Pedido de autorização — {{actionLabel}} {{workSheetReference}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'actionLabel',
    'workSheetReference',
    'workSheetTitle',
    'requesterEmail',
    'supportEmail',
    'currentYear',
    'footerAddress',
  ],
  htmlBody: `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  ${EMAIL_DESIGN_STYLE}
</head>
<body style="margin:0;padding:0;background:var(--color-background-secondary);">
<div style="background: var(--color-background-secondary); padding: 1.5rem;">
  <div style="background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); max-width: 560px; margin: 0 auto; padding: 2rem; font-family: var(--font-sans);">
    <p style="font-size: 15px; color: var(--color-text-primary); margin: 0 0 1rem;">Pedido de autorização</p>
    <p style="font-size: 14px; color: var(--color-text-secondary); line-height: 1.6;">
      <strong>{{requesterEmail}}</strong> pediu autorização para <strong>{{actionLabel}}</strong> na folha
      <strong>{{workSheetReference}}</strong> ({{workSheetTitle}}).
    </p>
    <p style="font-size: 13px; color: var(--color-text-secondary); margin-top: 1.25rem;">
      Inicie sessão como superadmin no CMS para executar a acção com confirmação por email.
    </p>
  </div>
</div>
</body>
</html>`,
};

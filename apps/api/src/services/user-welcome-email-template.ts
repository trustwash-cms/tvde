import { EMAIL_DESIGN_STYLE } from './email-design-tokens';

export const USER_WELCOME_EMAIL_TEMPLATE = {
  subject: 'Credenciais de acesso — {{appName}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'tenantName',
    'tenantSiteId',
    'userEmail',
    'username',
    'roleLabel',
    'temporaryPassword',
    'loginUrl',
    'expiresIn',
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

    <div style="background: #1A1A2E; padding: 2rem 2rem 1.5rem; text-align: center;">
      <div style="color: #fff; font-size: 20px; font-weight: 500; letter-spacing: 0.04em;">{{appNamePrefix}}<span style="color: #7F77DD;">.</span>{{appNameSuffix}}</div>
      <p style="color: #9999bb; font-size: 12px; margin: 6px 0 0;">Nova conta de utilizador</p>
    </div>

    <div style="padding: 2rem;">
      <p style="font-size: 15px; color: var(--color-text-primary); margin: 0 0 1rem;">Olá,</p>
      <p style="font-size: 14px; color: var(--color-text-secondary); line-height: 1.6; margin: 0 0 1.5rem;">
        Foi criada a sua conta (<strong style="color: var(--color-text-primary);">{{roleLabel}}</strong>) em
        <strong style="color: var(--color-text-primary);">{{tenantName}}</strong>.
        Utilize os dados abaixo para o primeiro acesso — terá de definir uma nova password de imediato.
      </p>

      <div style="background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 1.25rem; margin-bottom: 1.5rem;">
        <div style="font-size: 13px; padding: 5px 0;">
          <span style="color: var(--color-text-secondary);">Site ID</span><br />
          <span style="color: var(--color-text-primary); font-weight: 500; font-family: var(--font-mono);">{{tenantSiteId}}</span>
        </div>
        <div style="font-size: 13px; padding: 5px 0;">
          <span style="color: var(--color-text-secondary);">Username</span><br />
          <span style="color: var(--color-text-primary); font-weight: 500;">{{username}}</span>
        </div>
        <div style="font-size: 13px; padding: 5px 0;">
          <span style="color: var(--color-text-secondary);">Email</span><br />
          <span style="color: var(--color-text-primary); font-weight: 500;">{{userEmail}}</span>
        </div>
      </div>

      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 0.75rem;">Password temporária:</p>

      <div style="text-align: center; margin: 0 0 1.5rem;">
        <div style="display: inline-block; background: #EEEDFE; border: 0.5px solid #AFA9EC; border-radius: var(--border-radius-md); padding: 1rem 2rem;">
          <span style="font-size: 18px; font-weight: 500; letter-spacing: 0.08em; color: #3C3489; font-family: var(--font-mono);">{{temporaryPassword}}</span>
        </div>
        <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0.5rem 0 0;">
          Válida durante <strong style="color: var(--color-text-primary);">{{expiresIn}}</strong>
        </p>
      </div>

      <div style="text-align: center; margin-bottom: 1.5rem;">
        <a href="{{loginUrl}}" style="display:inline-block;background:#534AB7;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;">Iniciar sessão</a>
      </div>
    </div>

    <div style="background: var(--color-background-secondary); border-top: 0.5px solid var(--color-border-tertiary); padding: 1.25rem 2rem; text-align: center;">
      <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.6;">© {{currentYear}} {{appName}}{{footerAddress}}</p>
    </div>

  </div>
</div>
</body>
</html>`,
};

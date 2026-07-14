import { EMAIL_DESIGN_STYLE } from './email-design-tokens';

export const TENANT_WELCOME_EMAIL_TEMPLATE = {
  subject: 'Bem-vindo — credenciais de acesso {{appName}}',
  variables: [
    'appName',
    'appNamePrefix',
    'appNameSuffix',
    'tenantName',
    'tenantSiteId',
    'adminEmail',
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
      <p style="color: #9999bb; font-size: 12px; margin: 6px 0 0;">Credenciais de acesso ao tenant</p>
    </div>

    <div style="padding: 2rem;">
      <p style="font-size: 15px; color: var(--color-text-primary); margin: 0 0 1rem;">Olá,</p>
      <p style="font-size: 14px; color: var(--color-text-secondary); line-height: 1.6; margin: 0 0 1.5rem;">
        Foi criada a sua conta de administrador para o tenant <strong style="color: var(--color-text-primary);">{{tenantName}}</strong>.
        Utilize os dados abaixo para o primeiro acesso — terá de definir uma nova password de imediato.
      </p>

      <div style="background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 1.25rem; margin-bottom: 1.5rem;">
        <div style="font-size: 13px; padding: 5px 0;">
          <span style="color: var(--color-text-secondary);">Site ID</span><br />
          <span style="color: var(--color-text-primary); font-weight: 500; font-family: var(--font-mono);">{{tenantSiteId}}</span>
        </div>
        <div style="font-size: 13px; padding: 5px 0;">
          <span style="color: var(--color-text-secondary);">Email</span><br />
          <span style="color: var(--color-text-primary); font-weight: 500;">{{adminEmail}}</span>
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

      <div style="background: #EEEDFE; border: 0.5px solid #AFA9EC; border-radius: var(--border-radius-md); padding: 1rem 1.25rem; margin-bottom: 1.5rem;">
        <p style="font-size: 13px; color: #3C3489; margin: 0; line-height: 1.6;">
          No primeiro acesso será obrigado a alterar esta password. Se expirar antes de entrar, peça ao administrador um reenvio ou use «Esqueci a password» no login.
        </p>
      </div>

      <div style="height: 0.5px; background: var(--color-border-tertiary); margin: 1.5rem 0;"></div>

      <p style="font-size: 13px; color: var(--color-text-secondary); line-height: 1.6; margin: 0;">
        Dúvidas? Contacte <a href="mailto:{{supportEmail}}" style="color: #534AB7; text-decoration: none;">{{supportEmail}}</a>.
      </p>
    </div>

    <div style="background: var(--color-background-secondary); border-top: 0.5px solid var(--color-border-tertiary); padding: 1.25rem 2rem; text-align: center;">
      <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.6;">© {{currentYear}} {{appName}}{{footerAddress}}</p>
    </div>

  </div>
</div>
</body>
</html>`,
};

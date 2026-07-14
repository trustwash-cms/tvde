/** Design tokens for transactional HTML emails (CSS variables inlined for client compatibility). */
export const EMAIL_DESIGN_STYLE = `<style>
  :root {
    --color-background-secondary: #f4f4f5;
    --color-background-primary: #ffffff;
    --color-border-tertiary: #e4e4e7;
    --border-radius-lg: 12px;
    --border-radius-md: 8px;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
    --color-text-primary: #18181b;
    --color-text-secondary: #71717a;
  }
</style>`;

export function splitAppNameForEmail(appName: string): { appNamePrefix: string; appNameSuffix: string } {
  const trimmed = appName.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 0) {
    return {
      appNamePrefix: trimmed.slice(0, spaceIdx),
      appNameSuffix: trimmed.slice(spaceIdx + 1),
    };
  }
  return { appNamePrefix: trimmed, appNameSuffix: '' };
}

export function buildBaseEmailVariables(input: {
  appName: string;
  supportEmail: string;
  footerAddress?: string;
}): Record<string, string> {
  const { appNamePrefix, appNameSuffix } = splitAppNameForEmail(input.appName);
  return {
    appName: input.appName,
    appNamePrefix,
    appNameSuffix,
    supportEmail: input.supportEmail,
    currentYear: String(new Date().getFullYear()),
    footerAddress: input.footerAddress ?? '',
  };
}

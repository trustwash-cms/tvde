import { prisma } from '@tvde/database';
import type { Prisma } from '@tvde/database';
import {
  DEFAULT_ADMIN_MGMT_ALERT_DAYS,
  DEFAULT_ADMIN_MGMT_SEGURADORAS,
  DEFAULT_ADMIN_MGMT_TIPOS_PRODUTO,
  formatWhatsappPhone,
} from '@tvde/shared';
import { hashPassword, verifyPassword } from '../lib/password';

export interface AdminMgmtSettings {
  defaultAlertDays: number;
  defaultResponsavel: string | null;
  alertEmail: string | null;
  alertPhone: string | null;
  seguradoras: string[];
  tiposProduto: string[];
  syncFromMoloni: boolean;
  syncMoloniMarkPaidOnReceipt: boolean;
  securityPinConfigured: boolean;
}

export type AdminMgmtSettingsInput = Partial<AdminMgmtSettings> & {
  securityPin?: string;
  clearSecurityPin?: boolean;
};

function normalizeStringList(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}

function mapConfigToSettings(config: Record<string, unknown>): AdminMgmtSettings {
  const days = Number(config.defaultAlertDays);
  return {
    defaultAlertDays:
      Number.isFinite(days) && days >= 0 && days <= 365 ? days : DEFAULT_ADMIN_MGMT_ALERT_DAYS,
    defaultResponsavel:
      typeof config.defaultResponsavel === 'string' && config.defaultResponsavel.trim()
        ? config.defaultResponsavel.trim()
        : null,
    alertEmail:
      typeof config.alertEmail === 'string' && config.alertEmail.trim() ? config.alertEmail.trim() : null,
    alertPhone:
      typeof config.alertPhone === 'string' && config.alertPhone.trim() ? config.alertPhone.trim() : null,
    seguradoras: normalizeStringList(config.seguradoras, DEFAULT_ADMIN_MGMT_SEGURADORAS),
    tiposProduto: normalizeStringList(config.tiposProduto, DEFAULT_ADMIN_MGMT_TIPOS_PRODUTO),
    syncFromMoloni: config.syncFromMoloni === true,
    syncMoloniMarkPaidOnReceipt: config.syncMoloniMarkPaidOnReceipt !== false,
    securityPinConfigured:
      typeof config.securityPinHash === 'string' && config.securityPinHash.length > 0,
  };
}

async function readConfig(workspaceId: string): Promise<Record<string, unknown>> {
  const row = await prisma.workspaceModule.findUnique({
    where: { workspaceId_moduleKey: { workspaceId, moduleKey: 'admin_mgmt' } },
  });
  const raw = row?.configJson;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

export async function getAdminMgmtSettings(
  workspaceId: string,
  _tenantId: string
): Promise<AdminMgmtSettings> {
  const config = await readConfig(workspaceId);
  return mapConfigToSettings(config);
}

export async function verifyAdminMgmtSecurityPin(
  workspaceId: string,
  _tenantId: string,
  pin: string
): Promise<boolean> {
  const config = await readConfig(workspaceId);
  const hash = config.securityPinHash;
  if (typeof hash !== 'string' || !hash) return false;
  return verifyPassword(pin, hash);
}

export async function updateAdminMgmtSettings(
  workspaceId: string,
  tenantId: string,
  input: AdminMgmtSettingsInput
): Promise<AdminMgmtSettings> {
  const config = await readConfig(workspaceId);
  const current = mapConfigToSettings(config);

  const next: AdminMgmtSettings = {
    defaultAlertDays:
      input.defaultAlertDays !== undefined ? input.defaultAlertDays : current.defaultAlertDays,
    defaultResponsavel:
      input.defaultResponsavel !== undefined ? input.defaultResponsavel : current.defaultResponsavel,
    alertEmail:
      input.alertEmail !== undefined
        ? input.alertEmail?.trim() || null
        : current.alertEmail,
    alertPhone:
      input.alertPhone !== undefined
        ? input.alertPhone?.trim()
          ? formatWhatsappPhone(input.alertPhone) || input.alertPhone.trim()
          : null
        : current.alertPhone,
    seguradoras:
      input.seguradoras !== undefined
        ? input.seguradoras.map((s) => s.trim()).filter(Boolean)
        : current.seguradoras,
    tiposProduto:
      input.tiposProduto !== undefined
        ? input.tiposProduto.map((s) => s.trim()).filter(Boolean)
        : current.tiposProduto,
    syncFromMoloni:
      input.syncFromMoloni !== undefined ? input.syncFromMoloni : current.syncFromMoloni,
    syncMoloniMarkPaidOnReceipt:
      input.syncMoloniMarkPaidOnReceipt !== undefined
        ? input.syncMoloniMarkPaidOnReceipt
        : current.syncMoloniMarkPaidOnReceipt,
    securityPinConfigured: current.securityPinConfigured,
  };

  if (next.tiposProduto.length === 0) {
    next.tiposProduto = [...DEFAULT_ADMIN_MGMT_TIPOS_PRODUTO];
  }

  if (input.clearSecurityPin) {
    delete config.securityPinHash;
    next.securityPinConfigured = false;
  } else if (input.securityPin !== undefined && input.securityPin.trim()) {
    const pin = input.securityPin.trim();
    if (!/^\d{4,12}$/.test(pin)) {
      throw new Error('PIN de Segurança deve ter 4 a 12 dígitos');
    }
    config.securityPinHash = await hashPassword(pin);
    next.securityPinConfigured = true;
  }

  const configJson: Record<string, unknown> = {
    ...config,
    defaultAlertDays: next.defaultAlertDays,
    defaultResponsavel: next.defaultResponsavel,
    alertEmail: next.alertEmail,
    alertPhone: next.alertPhone,
    seguradoras: next.seguradoras,
    tiposProduto: next.tiposProduto,
    syncFromMoloni: next.syncFromMoloni,
    syncMoloniMarkPaidOnReceipt: next.syncMoloniMarkPaidOnReceipt,
  };

  await prisma.workspaceModule.upsert({
    where: { workspaceId_moduleKey: { workspaceId, moduleKey: 'admin_mgmt' } },
    create: {
      workspaceId,
      moduleKey: 'admin_mgmt',
      enabled: true,
      configJson: configJson as Prisma.InputJsonValue,
    },
    update: { configJson: configJson as Prisma.InputJsonValue },
  });

  return next;
}

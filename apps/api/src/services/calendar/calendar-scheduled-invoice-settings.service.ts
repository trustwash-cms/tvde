import { prisma } from '@tvde/database';
import {
  CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY,
  CALENDAR_SCHEDULED_INVOICE_ENABLED_KEY,
} from '@tvde/shared';
import { getBillingConnection, ensureMoloniAccessToken } from '../moloni-connection.service';

export async function resolveCalendarScheduledInvoiceAvailability(
  tenantId: string,
  workspaceId: string
) {
  const [tenantModule, workspaceModule, connection] = await Promise.all([
    prisma.tenantModule.findFirst({
      where: { tenantId, moduleKey: 'billing', allowed: true },
    }),
    prisma.workspaceModule.findFirst({
      where: { workspaceId, moduleKey: 'billing', enabled: true },
    }),
    getBillingConnection(workspaceId),
  ]);

  const moduleActive = Boolean(tenantModule && workspaceModule);
  const moloniConfigured = Boolean(connection?.clientId);
  const moloniConnected = Boolean(connection?.encryptedRefreshToken && connection.connectedAt);

  return {
    moduleActive,
    moloniConfigured,
    moloniConnected,
    canEnable: moduleActive && moloniConnected,
  };
}

export async function isCalendarScheduledInvoiceEnabled(tenantId: string, workspaceId: string) {
  const availability = await resolveCalendarScheduledInvoiceAvailability(tenantId, workspaceId);
  if (!availability.canEnable) return false;

  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: CALENDAR_SCHEDULED_INVOICE_ENABLED_KEY } },
  });
  return row?.value === 'true';
}

export async function getCalendarScheduledInvoiceSettings(tenantId: string, workspaceId: string) {
  const billing = await resolveCalendarScheduledInvoiceAvailability(tenantId, workspaceId);
  const [enabledRow, categoryRow] = await Promise.all([
    prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: CALENDAR_SCHEDULED_INVOICE_ENABLED_KEY } },
    }),
    prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY } },
    }),
  ]);

  let moloniCategories: Array<{ id: number; name: string }> = [];
  if (billing.moloniConnected) {
    try {
      const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
      if (row.companyId) {
        const categories = await moloniClient.getAllProductCategories(row.companyId, 0, 0, 100);
        moloniCategories = categories.map((c) => ({
          id: c.category_id,
          name: c.name,
        }));
      }
    } catch {
      moloniCategories = [];
    }
  }

  const defaultCategoryId = categoryRow?.value ? Number(categoryRow.value) : null;

  return {
    enabled: enabledRow?.value === 'true',
    defaultCategoryId: Number.isNaN(defaultCategoryId) ? null : defaultCategoryId,
    moloniCategories,
    billing,
  };
}

export async function saveCalendarScheduledInvoiceSettings(
  tenantId: string,
  workspaceId: string,
  input: { enabled?: boolean; defaultCategoryId?: number | null }
) {
  if (input.enabled) {
    const availability = await resolveCalendarScheduledInvoiceAvailability(tenantId, workspaceId);
    if (!availability.moduleActive) {
      throw new Error('Módulo Facturação não está activo neste workspace');
    }
    if (!availability.moloniConnected) {
      throw new Error('Moloni não está ligado — configure em Configurações → Moloni');
    }
  }

  if (input.enabled != null) {
    await prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: CALENDAR_SCHEDULED_INVOICE_ENABLED_KEY } },
      create: {
        tenantId,
        key: CALENDAR_SCHEDULED_INVOICE_ENABLED_KEY,
        value: input.enabled ? 'true' : 'false',
      },
      update: { value: input.enabled ? 'true' : 'false' },
    });
  }

  if (input.defaultCategoryId !== undefined) {
    if (input.defaultCategoryId == null) {
      await prisma.tenantSetting.deleteMany({
        where: { tenantId, key: CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY },
      });
    } else {
      await prisma.tenantSetting.upsert({
        where: { tenantId_key: { tenantId, key: CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY } },
        create: {
          tenantId,
          key: CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY,
          value: String(input.defaultCategoryId),
        },
        update: { value: String(input.defaultCategoryId) },
      });
    }
  }

  return getCalendarScheduledInvoiceSettings(tenantId, workspaceId);
}

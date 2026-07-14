import { prisma } from '@tvde/database';
import type { Role } from '@tvde/shared';
import { filterTvdeModules } from '@tvde/shared';
import { getMoloniPublicStatus } from './billing.service';
import { getSmsPublicInfo } from './sms.service';
import { getModuleCapabilities } from './tenant-modules.service';

export type ModuleHealthStatus = 'core' | 'ok' | 'warning' | 'error' | 'inactive';

export interface ModuleHealthItem {
  key: string;
  status: ModuleHealthStatus;
  label: string;
  detail?: string;
}

async function healthForIntegration(
  moduleKey: string,
  workspaceId: string | null,
  tenantId: string | null
): Promise<Pick<ModuleHealthItem, 'status' | 'label' | 'detail'>> {
  if (moduleKey === 'sms') {
    const sms = await getSmsPublicInfo();
    if (!sms.configured && !sms.usingEnvFallback && !sms.devMockActive) {
      return { status: 'error', label: 'Não configurado', detail: 'Defina credenciais SMS' };
    }
    if (sms.devMockActive) {
      return { status: 'warning', label: 'Mock dev', detail: 'SMS simulado em desenvolvimento' };
    }
    return { status: 'ok', label: 'Operacional' };
  }

  if (moduleKey === 'calendar') {
    if (!workspaceId) {
      return { status: 'warning', label: 'Sem workspace', detail: 'Seleccione um workspace' };
    }
    const count = await prisma.calendar.count({ where: { workspaceId } });
    if (count === 0) {
      return {
        status: 'warning',
        label: 'Sem calendários',
        detail: 'Crie em Configurações → Calendário',
      };
    }
    return { status: 'ok', label: 'Operacional', detail: `${count} calendário(s)` };
  }

  if (moduleKey === 'billing') {
    if (!workspaceId) {
      return { status: 'warning', label: 'Sem workspace', detail: 'Seleccione um workspace' };
    }
    const moloni = await getMoloniPublicStatus(workspaceId, { probe: false });
    if (moloni.moduleAuthorized === false) {
      return {
        status: 'inactive',
        label: 'Não autorizado',
        detail: 'Autorize billing no tenant (Tenants)',
      };
    }
    if (moloni.moduleActive === false) {
      return {
        status: 'warning',
        label: 'Inactivo',
        detail: 'Active billing no workspace',
      };
    }
    if (!moloni.configured) {
      return { status: 'error', label: 'Não configurado', detail: 'Configure Moloni' };
    }
    if (moloni.documentSetHealth && !moloni.documentSetHealth.ok) {
      return {
        status: moloni.documentSetHealth.severity === 'error' ? 'error' : 'warning',
        label: moloni.documentSetHealth.severity === 'error' ? 'Com problemas' : 'Atenção',
        detail: moloni.documentSetHealth.userMessage,
      };
    }
    if (!moloni.healthy) {
      return { status: 'error', label: 'Com problemas', detail: moloni.statusMessage };
    }
    return {
      status: 'ok',
      label: 'Operacional',
      detail: moloni.documentSetHealth?.userMessage ?? moloni.statusMessage,
    };
  }

  if (moduleKey === 'admin_mgmt') {
    if (!workspaceId) {
      return { status: 'warning', label: 'Sem workspace', detail: 'Seleccione um workspace' };
    }
    return { status: 'ok', label: 'Activo' };
  }

  return { status: 'ok', label: 'Activo' };
}

const INTEGRATION_KEYS = new Set(['sms', 'billing', 'calendar', 'admin_mgmt']);

export async function getModulesHealth(
  role: Role,
  tenantId: string | null,
  workspaceId: string | null
): Promise<ModuleHealthItem[]> {
  const [modules, caps] = await Promise.all([
    filterTvdeModules(
      await prisma.moduleRegistry.findMany({
        orderBy: [{ isCore: 'desc' }, { name: 'asc' }],
      })
    ),
    getModuleCapabilities(role, tenantId, workspaceId),
  ]);

  const items: ModuleHealthItem[] = [];

  for (const mod of modules) {
    if (mod.isCore) {
      items.push({ key: mod.key, status: 'core', label: 'Core' });
      continue;
    }

    if (role !== 'master' && !caps.allowedModules.includes(mod.key)) {
      items.push({
        key: mod.key,
        status: 'inactive',
        label: 'Não autorizado',
        detail: 'Não incluído no plano deste cliente',
      });
      continue;
    }

    if (role !== 'master' && !caps.activeModules.includes(mod.key)) {
      items.push({
        key: mod.key,
        status: 'warning',
        label: 'Inactivo',
        detail: 'Active em Workspaces',
      });
      continue;
    }

    if (INTEGRATION_KEYS.has(mod.key)) {
      const integration = await healthForIntegration(mod.key, workspaceId, tenantId);
      items.push({ key: mod.key, ...integration });
      continue;
    }

    items.push({ key: mod.key, status: 'ok', label: 'Activo' });
  }

  return items;
}

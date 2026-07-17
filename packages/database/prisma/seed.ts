import { loadEnvFile, requireEnv, envOr } from '@tvde/shared/server';
import { REMOVED_MODULE_KEYS } from '@tvde/shared';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

loadEnvFile();

const prisma = new PrismaClient();

const CORE_MODULES = [
  { key: 'auth', name: 'Auth & Users', isCore: true, description: 'Autenticação e gestão de utilizadores' },
  { key: 'tenancy', name: 'Tenancy', isCore: true, description: 'Gestão de tenants e planos' },
  { key: 'workspaces', name: 'Workspaces', isCore: true, description: 'Workspaces por tenant' },
  { key: 'audit', name: 'Audit Log', isCore: true, description: 'Registo imutável de acções' },
];

const BUSINESS_MODULES = [
  { key: 'clients', name: 'Clientes', description: 'CRM básico' },
  { key: 'billing', name: 'Facturação', description: 'Faturas Moloni e documentos' },
  { key: 'bolt', name: 'Bolt', description: 'Integração API Bolt — pedidos, motoristas e veículos' },
  { key: 'uber', name: 'Uber', description: 'Integração e gestão Uber' },
  { key: 'via_verde', name: 'Via Verde', description: 'Portagens e Via Verde' },
  { key: 'eletricidade', name: 'Eletricidade', description: 'Consumos e custos de eletricidade da frota' },
  { key: 'combustivel', name: 'Combustível', description: 'Abastecimentos e combustível' },
  { key: 'pagamentos', name: 'Pagamentos', description: 'Pagamentos e tesouraria da frota' },
  { key: 'calendar', name: 'Calendário', description: 'Agenda partilhada, lembretes e anexos' },
  {
    key: 'admin_mgmt',
    name: 'Gestão Administrativa',
    description: 'Seguros, contratos, pessoal, fiscal e alertas de vencimentos',
  },
  { key: 'sms', name: 'SMS', description: 'Envio de SMS (2FA, notificações)' },
  { key: 'media', name: 'Media / Files', description: 'Upload e gestão de ficheiros' },
  { key: 'webhooks', name: 'Webhooks', description: 'Integrações externas' },
  { key: 'api-keys', name: 'API Keys', description: 'Chaves de API' },
  { key: 'reports', name: 'Relatórios', description: 'KPIs e dashboards' },
];

async function main() {
  const masterEmail = envOr('SEED_MASTER_EMAIL', 'master@tvde.local');
  const masterPassword = requireEnv('SEED_MASTER_PASSWORD');
  const seedDemo = process.env.SEED_DEMO === 'true';

  console.log('Seeding TVDE database...');

  await prisma.workspaceModule.deleteMany({ where: { moduleKey: { in: [...REMOVED_MODULE_KEYS] } } });
  await prisma.tenantModule.deleteMany({ where: { moduleKey: { in: [...REMOVED_MODULE_KEYS] } } });
  await prisma.moduleRegistry.deleteMany({ where: { key: { in: [...REMOVED_MODULE_KEYS] } } });

  for (const mod of [...CORE_MODULES, ...BUSINESS_MODULES]) {
    await prisma.moduleRegistry.upsert({
      where: { key: mod.key },
      update: { name: mod.name, description: mod.description, isCore: mod.isCore ?? false },
      create: { ...mod, isCore: mod.isCore ?? false },
    });
  }

  const masterPasswordHash = await bcrypt.hash(masterPassword, 12);

  const existingMaster = await prisma.user.findFirst({
    where: { role: UserRole.master },
    select: { id: true, email: true },
  });

  const emailConflict = await prisma.user.findUnique({
    where: { email: masterEmail },
    select: { id: true, role: true },
  });

  if (
    emailConflict
    && emailConflict.role !== UserRole.master
    && emailConflict.id !== existingMaster?.id
  ) {
    throw new Error(
      `SEED_MASTER_EMAIL "${masterEmail}" já está registado como ${emailConflict.role}. ` +
        'Use outro email no .env ou altere/remova esse utilizador antes de correr o seed.'
    );
  }

  if (existingMaster) {
    await prisma.user.update({
      where: { id: existingMaster.id },
      data: {
        email: masterEmail,
        passwordHash: masterPasswordHash,
        status: 'active',
        tenantId: null,
        workspaceId: null,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        email: masterEmail,
        passwordHash: masterPasswordHash,
        role: UserRole.master,
        status: 'active',
        tenantId: null,
        workspaceId: null,
      },
    });
  }

  if (seedDemo) {
    const demoSiteId = envOr('SEED_DEMO_SITE_ID', 'frota-demo');
    const demoTenantName = envOr('SEED_DEMO_TENANT_NAME', 'Frota Demo');
    const fleetManagerEmail = envOr('SEED_DEMO_FLEET_MANAGER_EMAIL', 'gestor@frota-demo.local');
    const fleetManagerPassword = requireEnv('SEED_DEMO_FLEET_MANAGER_PASSWORD');
    const driverEmail = envOr('SEED_DEMO_DRIVER_EMAIL', 'motorista@frota-demo.local');
    const driverPassword = requireEnv('SEED_DEMO_DRIVER_PASSWORD');

    const tenant = await prisma.tenant.upsert({
    where: { siteId: demoSiteId },
    update: {},
    create: {
      siteId: demoSiteId,
      name: demoTenantName,
      plan: 'professional',
      limitsJson: {
        storage_gb: 10,
        max_users: 50,
        max_products: 500,
        max_workspaces: 1,
        max_vehicles: 30,
        api_calls_month: 10000,
      },
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'principal' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Frota Principal',
      slug: 'principal',
      type: 'general',
    },
  });

  for (const mod of BUSINESS_MODULES) {
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleKey: { tenantId: tenant.id, moduleKey: mod.key } },
      update: { allowed: true },
      create: {
        tenantId: tenant.id,
        moduleKey: mod.key,
        allowed: true,
        allowedAt: new Date(),
      },
    });
  }

  for (const mod of [...CORE_MODULES, ...BUSINESS_MODULES]) {
    await prisma.workspaceModule.upsert({
      where: { workspaceId_moduleKey: { workspaceId: workspace.id, moduleKey: mod.key } },
      update: {},
      create: {
        workspaceId: workspace.id,
        moduleKey: mod.key,
        enabled: true,
        enabledAt: new Date(),
      },
    });
  }

  await prisma.user.upsert({
    where: { email: fleetManagerEmail },
    update: {
      passwordHash: await bcrypt.hash(fleetManagerPassword, 12),
      status: 'active',
      tenantId: tenant.id,
      workspaceId: workspace.id,
    },
    create: {
      email: fleetManagerEmail,
      passwordHash: await bcrypt.hash(fleetManagerPassword, 12),
      role: UserRole.superadmin,
      status: 'active',
      tenantId: tenant.id,
      workspaceId: workspace.id,
    },
  });

  await prisma.user.upsert({
    where: { email: driverEmail },
    update: {
      passwordHash: await bcrypt.hash(driverPassword, 12),
      status: 'active',
      tenantId: tenant.id,
      workspaceId: workspace.id,
    },
    create: {
      email: driverEmail,
      passwordHash: await bcrypt.hash(driverPassword, 12),
      role: UserRole.admin,
      status: 'active',
      tenantId: tenant.id,
      workspaceId: workspace.id,
    },
  });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: 'seed.completed',
        entityType: 'system',
        afterJson: { message: 'TVDE demo seed completed' },
      },
    });

    console.log('Seed completed.');
    console.log(`  MASTER: ${masterEmail}`);
    console.log(`  Gestor de Frota (${demoSiteId}): ${fleetManagerEmail}`);
    console.log(`  Motorista (${demoSiteId}): ${driverEmail}`);
  } else {
    console.log('Seed completed.');
    console.log(`  MASTER: ${masterEmail}`);
    console.log('  Demo tenant: omitido (SEED_DEMO não está true no .env)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

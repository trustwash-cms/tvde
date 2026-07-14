import { loadEnvFile } from '@tvde/shared/server';
import { PrismaClient } from '@prisma/client';

loadEnvFile();

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function setTenantContext(tenantId: string | null): Promise<void> {
  if (tenantId) {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${tenantId}', true)`
    );
  } else {
    await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '', true)`);
  }
}

export * from '@prisma/client';

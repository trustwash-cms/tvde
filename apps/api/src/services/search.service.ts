import { prisma } from '@tvde/database';
import type { SearchResult } from '@tvde/shared';
import { canAccessDashboardArea, canAccessClientsDashboard, canManageUser, type Role } from '@tvde/shared';
import { getModuleCapabilities } from './tenant-modules.service';

const PER_TYPE_LIMIT = 6;
export const MIN_SEARCH_LENGTH = 2;

function contains(q: string) {
  return { contains: q, mode: 'insensitive' as const };
}

function textOr(q: string, fields: string[]) {
  return { OR: fields.map((field) => ({ [field]: contains(q) })) };
}

interface SearchContext {
  role: Role;
  tenantId: string | null;
  workspaceId: string | null;
}

async function searchTenants(q: string): Promise<SearchResult[]> {
  const rows = await prisma.tenant.findMany({
    where: textOr(q, ['name', 'siteId']),
    take: PER_TYPE_LIMIT,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, siteId: true, plan: true },
  });

  return rows.map((t) => ({
    type: 'tenant' as const,
    id: t.id,
    title: t.name,
    subtitle: `${t.siteId} · ${t.plan}`,
  }));
}

async function searchWorkspaces(q: string, ctx: SearchContext): Promise<SearchResult[]> {
  const where = {
    ...(ctx.role === 'master' ? {} : { tenantId: ctx.tenantId! }),
    OR: [
      { name: contains(q) },
      { slug: contains(q) },
      { type: contains(q) },
      ...(ctx.role === 'master'
        ? [{ tenant: { name: contains(q) } }, { tenant: { siteId: contains(q) } }]
        : []),
    ],
  };

  const rows = await prisma.workspace.findMany({
    where,
    take: PER_TYPE_LIMIT,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      tenant: { select: { name: true, siteId: true } },
    },
  });

  return rows.map((w) => ({
    type: 'workspace' as const,
    id: w.id,
    title: w.name,
    subtitle: ctx.role === 'master'
      ? `${w.tenant.name} · ${w.slug}`
      : `${w.slug} · ${w.type}`,
  }));
}

async function searchUsers(q: string, ctx: SearchContext): Promise<SearchResult[]> {
  const where = {
    ...(ctx.role === 'master' ? { role: { not: 'master' as const } } : { tenantId: ctx.tenantId! }),
    email: contains(q),
  };

  const rows = await prisma.user.findMany({
    where,
    take: PER_TYPE_LIMIT * 2,
    orderBy: { email: 'asc' },
    select: {
      id: true,
      email: true,
      role: true,
      tenant: { select: { name: true, siteId: true } },
    },
  });

  return rows
    .filter((u) => canManageUser(ctx.role, u.role as Role) || ctx.role === 'master')
    .slice(0, PER_TYPE_LIMIT)
    .map((u) => ({
      type: 'user' as const,
      id: u.id,
      title: u.email,
      subtitle: ctx.role === 'master' && u.tenant
        ? `${u.role} · ${u.tenant.name}`
        : u.role,
    }));
}

async function searchCrmClients(q: string, ctx: SearchContext): Promise<SearchResult[]> {
  const where = {
    ...(ctx.role === 'master' ? {} : { tenantId: ctx.tenantId! }),
    OR: [
      { name: contains(q) },
      { email: contains(q) },
      { phone: contains(q) },
      { nif: contains(q) },
    ],
  };

  const rows = await prisma.client.findMany({
    where,
    take: PER_TYPE_LIMIT,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      tenant: { select: { name: true } },
    },
  });

  return rows.map((c) => ({
    type: 'client' as const,
    id: c.id,
    title: c.name,
    subtitle: c.email ?? (ctx.role === 'master' ? c.tenant.name : null),
  }));
}

export async function globalSearch(
  ctx: SearchContext,
  query: string
): Promise<{ query: string; results: SearchResult[] }> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_LENGTH) {
    return { query: q, results: [] };
  }

  const tasks: Promise<SearchResult[]>[] = [];

  if (canAccessDashboardArea(ctx.role, 'tenants')) {
    tasks.push(searchTenants(q));
  }

  if (canAccessDashboardArea(ctx.role, 'workspaces')) {
    tasks.push(searchWorkspaces(q, ctx));
  }

  if (canAccessDashboardArea(ctx.role, 'users')) {
    tasks.push(searchUsers(q, ctx));
  }

  let clientsAllowed = canAccessClientsDashboard(ctx.role);

  if (ctx.role !== 'master' && ctx.tenantId) {
    const caps = await getModuleCapabilities(ctx.role, ctx.tenantId, ctx.workspaceId);
    if (clientsAllowed) clientsAllowed = caps.activeModules.includes('clients');
  }

  if (clientsAllowed) {
    tasks.push(searchCrmClients(q, ctx));
  }

  const groups = await Promise.all(tasks);
  return { query: q, results: groups.flat() };
}

/** Filtro reutilizável nas listagens GET (?q=) */
export function parseSearchQuery(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const q = raw.trim();
  return q.length >= MIN_SEARCH_LENGTH ? q : undefined;
}

export { textOr, contains, PER_TYPE_LIMIT };

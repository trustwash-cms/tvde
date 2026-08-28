import { prisma } from '@tvde/database';

async function touchStatusIfChanged(
  fetchCurrent: () => Promise<{ lastError: string | null } | null>,
  update: (data: { lastError: string | null; lastCheckedAt: Date }) => Promise<unknown>,
  nextError: string | null
): Promise<void> {
  const current = await fetchCurrent();
  if (!current) return;

  const prevError = current.lastError;
  if (prevError === nextError) return;

  await update({
    lastError: nextError,
    lastCheckedAt: new Date(),
  });
}

export async function touchPbsServerStatusIfChanged(
  serverId: string,
  nextError: string | null
): Promise<void> {
  await touchStatusIfChanged(
    () => prisma.virtualizationPbsServer.findUnique({ where: { id: serverId }, select: { lastError: true } }),
    (data) => prisma.virtualizationPbsServer.update({ where: { id: serverId }, data }),
    nextError
  );
}

export async function touchPveServerStatusIfChanged(
  serverId: string,
  nextError: string | null
): Promise<void> {
  await touchStatusIfChanged(
    () => prisma.virtualizationPveServer.findUnique({ where: { id: serverId }, select: { lastError: true } }),
    (data) => prisma.virtualizationPveServer.update({ where: { id: serverId }, data }),
    nextError
  );
}

export async function touchZerotierAccountStatusIfChanged(
  accountId: string,
  nextError: string | null
): Promise<void> {
  await touchStatusIfChanged(
    () =>
      prisma.virtualizationZerotierAccount.findUnique({
        where: { id: accountId },
        select: { lastError: true },
      }),
    (data) => prisma.virtualizationZerotierAccount.update({ where: { id: accountId }, data }),
    nextError
  );
}

export async function touchZerotierNetworkStatusIfChanged(
  networkRowId: string,
  nextError: string | null,
  counts?: { lastMemberCount: number; lastAuthorizedCount: number }
): Promise<void> {
  const current = await prisma.virtualizationZerotierNetwork.findUnique({
    where: { id: networkRowId },
    select: {
      lastError: true,
      lastMemberCount: true,
      lastAuthorizedCount: true,
    },
  });
  if (!current) return;

  const errorChanged = current.lastError !== nextError;
  const countsChanged =
    counts != null &&
    (current.lastMemberCount !== counts.lastMemberCount ||
      current.lastAuthorizedCount !== counts.lastAuthorizedCount);

  if (!errorChanged && !countsChanged) return;

  await prisma.virtualizationZerotierNetwork.update({
    where: { id: networkRowId },
    data: {
      lastError: nextError,
      lastCheckedAt: new Date(),
      ...(counts
        ? {
            lastMemberCount: counts.lastMemberCount,
            lastAuthorizedCount: counts.lastAuthorizedCount,
          }
        : {}),
    },
  });
}

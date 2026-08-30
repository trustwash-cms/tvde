import { prisma } from '@tvde/database';
import { evaluateVirtualizationAlerts } from '../services/virtualization-alerts.service';

export async function runVirtualizationAlertChecks(): Promise<
  Array<{ workspaceId: string; opened: number; resolved: number; notified: number }>
> {
  const [settingsRows, pbsRows, pveRows] = await Promise.all([
    prisma.virtualizationSetting.findMany({ select: { workspaceId: true, tenantId: true } }),
    prisma.virtualizationPbsServer.findMany({
      where: { isActive: true },
      select: { workspaceId: true, tenantId: true },
      distinct: ['workspaceId'],
    }),
    prisma.virtualizationPveServer.findMany({
      where: { isActive: true },
      select: { workspaceId: true, tenantId: true },
      distinct: ['workspaceId'],
    }),
  ]);

  const byWorkspace = new Map<string, { workspaceId: string; tenantId: string }>();
  for (const row of [...settingsRows, ...pbsRows, ...pveRows]) {
    byWorkspace.set(row.workspaceId, row);
  }
  const settingsRowsUnique = [...byWorkspace.values()];

  const summary: Array<{ workspaceId: string; opened: number; resolved: number; notified: number }> =
    [];

  for (const row of settingsRowsUnique) {
    try {
      const result = await evaluateVirtualizationAlerts(row.tenantId, row.workspaceId);
      if (result.opened > 0 || result.resolved > 0 || result.notified > 0) {
        summary.push({ workspaceId: row.workspaceId, ...result });
        console.log(
          `[virtualization-alerts] workspace ${row.workspaceId}: opened=${result.opened} resolved=${result.resolved} notified=${result.notified}`
        );
      }
    } catch (err) {
      console.error(
        `[virtualization-alerts] workspace ${row.workspaceId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return summary;
}

export function startVirtualizationAlertWorker() {
  const tick = async () => {
    try {
      await runVirtualizationAlertChecks();
    } catch (err) {
      console.error(
        '[virtualization-alerts] tick failed:',
        err instanceof Error ? err.message : err
      );
    }
  };

  const settingsTick = async () => {
    const rows = await prisma.virtualizationSetting.findMany({
      select: { pollIntervalMinutes: true },
    });
    const minInterval =
      rows.length > 0 ? Math.min(...rows.map((row) => row.pollIntervalMinutes)) : 5;
    return Math.max(60_000, minInterval * 60_000);
  };

  let timer: NodeJS.Timeout | null = null;

  const schedule = async () => {
    if (timer) clearInterval(timer);
    const intervalMs = await settingsTick();
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    console.log(`[virtualization-alerts] worker activo (intervalo mín. ${intervalMs / 60_000} min)`);
  };

  void tick();
  void schedule();

  setInterval(() => {
    void schedule();
  }, 15 * 60_000);
}

import { prisma } from '@tvde/database';
import { getVirtualizationDashboard } from '../services/virtualization.service';

export async function runVirtualizationBackupAlertChecks(): Promise<
  Array<{ workspaceId: string; failures: number }>
> {
  const settingsRows = await prisma.virtualizationSetting.findMany({
    where: { notifyOnBackupFailure: true },
    select: { workspaceId: true, tenantId: true, pollIntervalMinutes: true },
  });

  const summary: Array<{ workspaceId: string; failures: number }> = [];

  for (const row of settingsRows) {
    try {
      const dashboard = await getVirtualizationDashboard(row.tenantId, row.workspaceId);
      const failures = dashboard.recentFailures.length;
      if (failures > 0) {
        summary.push({ workspaceId: row.workspaceId, failures });
        // WhatsApp/email dispatch will plug in here.
        console.log(
          `[virtualization-alerts] workspace ${row.workspaceId}: ${failures} falha(s) de backup recente(s)`
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
      await runVirtualizationBackupAlertChecks();
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

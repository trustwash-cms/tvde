import { statfs } from 'node:fs/promises';
import os from 'node:os';
import type { PlatformHostStats } from '@tvde/shared';

function readCpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.irq +
      cpu.times.idle;
  }
  return { idle, total };
}

function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

async function measureCpuUsagePercent(): Promise<{ count: number; usagePercent: number }> {
  const count = os.cpus().length;
  const a = readCpuTimes();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const b = readCpuTimes();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  const usagePercent =
    totalDelta > 0 ? clampPercent(((totalDelta - idleDelta) / totalDelta) * 100) : 0;
  return { count, usagePercent };
}

async function readRootStorage(): Promise<{
  totalBytes: number;
  usedBytes: number;
  usagePercent: number;
  mountPath: string;
}> {
  const mountPath = process.platform === 'win32' ? process.cwd().split(/[/\\]/)[0] + '\\' : '/';
  try {
    const stats = await statfs(mountPath);
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    const availableBytes = Number(stats.bavail) * blockSize;
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    const usagePercent = totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0;
    return { totalBytes, usedBytes, usagePercent, mountPath };
  } catch {
    return { totalBytes: 0, usedBytes: 0, usagePercent: 0, mountPath };
  }
}

export async function getPlatformHostStats(): Promise<PlatformHostStats> {
  const [cpu, storage] = await Promise.all([measureCpuUsagePercent(), readRootStorage()]);
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usagePercent = totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0;

  return {
    cpu,
    memory: { totalBytes, usedBytes, usagePercent },
    storage,
    sampledAt: new Date().toISOString(),
  };
}

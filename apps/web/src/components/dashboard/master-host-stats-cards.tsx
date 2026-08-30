'use client';

import { useEffect, useState } from 'react';
import { Cpu, HardDrive, MemoryStick } from 'lucide-react';
import type { PlatformHostStats } from '@tvde/shared';
import { formatStorageBytes } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

const REFRESH_MS = 5_000;

function usageBarClass(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function HostStatCard({
  label,
  icon: Icon,
  iconClass,
  iconBgClass,
  primary,
  secondary,
  percent,
}: {
  label: string;
  icon: typeof Cpu;
  iconClass: string;
  iconBgClass: string;
  primary: string;
  secondary: string;
  percent: number;
}) {
  return (
    <div className="card flex min-w-0 items-center gap-2.5 !p-3">
      <div className={`shrink-0 rounded-lg p-2 ${iconBgClass} ${iconClass}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-sm font-bold leading-tight text-slate-900">{primary}</div>
        <div className="text-[11px] text-slate-500">{secondary}</div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-300 ${usageBarClass(percent)}`}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function MasterHostStatsCards() {
  const [stats, setStats] = useState<PlatformHostStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await apiFetch<PlatformHostStats>(API_PATHS.platform.hostStats, {}, getStoredToken());
      if (cancelled) return;
      if (res.data) {
        setStats(res.data);
        setError('');
      } else if (res.error) {
        setError(res.error);
      }
    }

    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (error && !stats) {
    return <p className="text-xs text-amber-700">Métricas do servidor indisponíveis: {error}</p>;
  }

  if (!stats) {
    return (
      <div className="grid gap-2.5 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-[72px] animate-pulse !p-3 bg-slate-50" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      <HostStatCard
        label="CPU"
        icon={Cpu}
        iconClass="text-violet-700"
        iconBgClass="bg-violet-50"
        primary={`${stats.cpu.usagePercent}%`}
        secondary={`${stats.cpu.count} CPU${stats.cpu.count === 1 ? '' : 's'}`}
        percent={stats.cpu.usagePercent}
      />
      <HostStatCard
        label="Memória"
        icon={MemoryStick}
        iconClass="text-sky-700"
        iconBgClass="bg-sky-50"
        primary={`${stats.memory.usagePercent}%`}
        secondary={`${formatStorageBytes(stats.memory.usedBytes)} / ${formatStorageBytes(stats.memory.totalBytes)}`}
        percent={stats.memory.usagePercent}
      />
      <HostStatCard
        label="Armazenamento"
        icon={HardDrive}
        iconClass="text-teal-700"
        iconBgClass="bg-teal-50"
        primary={`${formatStorageBytes(stats.storage.usedBytes)} / ${formatStorageBytes(stats.storage.totalBytes)}`}
        secondary={`${stats.storage.usagePercent}% · ${stats.storage.mountPath || '/'}`}
        percent={stats.storage.usagePercent}
      />
    </div>
  );
}

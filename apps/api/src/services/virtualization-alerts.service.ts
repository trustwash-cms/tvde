import { randomUUID } from 'node:crypto';
import { prisma } from '@tvde/database';
import {
  VIRTUALIZATION_ALERT_COOLDOWN_MINUTES,
  VIRTUALIZATION_ALERT_LEVEL_RANK,
  formatVirtualizationPercent,
  formatWhatsappPhone,
  getVirtualizationAlertKindLabel,
  getVirtualizationAlertLevelLabel,
  type VirtualizationAlertIncidentPublic,
  type VirtualizationAlertKind,
  type VirtualizationAlertLevel,
  type VirtualizationAlertStatus,
  type VirtualizationAlertSummary,
  type VirtualizationSettingsPublic,
} from '@tvde/shared';
import { EmailNotConfiguredError, sendEmail } from './email.service';
import { getVirtualizationDashboard, getVirtualizationSettings } from './virtualization.service';
import { getVirtualizationPveAlertContext } from './virtualization-pve.service';
import { sendWhatsappMessage } from './whatsapp-bridge.client';

const STORAGE_WARNING = 80;
const STORAGE_HIGH = 90;
const STORAGE_CRITICAL = 95;
const NODE_CPU_WARNING = 0.85;
const NODE_CPU_HIGH = 0.9;
const NODE_RAM_WARNING = 0.9;
const NODE_RAM_HIGH = 0.95;
const BACKUP_STALE_HOURS = 26;

type AlertSignal = {
  fingerprint: string;
  kind: VirtualizationAlertKind;
  level: VirtualizationAlertLevel;
  title: string;
  message: string;
  sourceType: 'pve' | 'pbs' | 'app';
  sourceId: string | null;
  sourceLabel: string;
  metricValue?: number;
  payload?: Record<string, unknown>;
};

type IncidentRow = {
  id: string;
  fingerprint: string;
  kind: string;
  level: string;
  status: string;
  title: string;
  message: string;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string;
  metricValue: number | null;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastNotifiedAt: Date | null;
  acknowledgedAt: Date | null;
  silencedUntil: Date | null;
  resolvedAt: Date | null;
};

function isLevel(value: string): value is VirtualizationAlertLevel {
  return value in VIRTUALIZATION_ALERT_LEVEL_RANK;
}

function isStatus(value: string): value is VirtualizationAlertStatus {
  return value === 'open' || value === 'acknowledged' || value === 'silenced' || value === 'resolved';
}

function isKind(value: string): value is VirtualizationAlertKind {
  return (
    value === 'server_unreachable' ||
    value === 'node_offline' ||
    value === 'node_cpu_high' ||
    value === 'node_ram_high' ||
    value === 'storage_unavailable' ||
    value === 'storage_usage' ||
    value === 'backup_failed' ||
    value === 'backup_stale' ||
    value === 'vm_unexpected_stop'
  );
}

function mapIncident(row: IncidentRow): VirtualizationAlertIncidentPublic {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    kind: isKind(row.kind) ? row.kind : 'server_unreachable',
    level: isLevel(row.level) ? row.level : 'warning',
    status: isStatus(row.status) ? row.status : 'open',
    title: row.title,
    message: row.message,
    sourceType: row.sourceType === 'pve' || row.sourceType === 'pbs' ? row.sourceType : 'app',
    sourceId: row.sourceId,
    sourceLabel: row.sourceLabel,
    metricValue: row.metricValue,
    occurrenceCount: row.occurrenceCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastNotifiedAt: row.lastNotifiedAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    silencedUntil: row.silencedUntil?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function storageLevel(usedPercent: number): VirtualizationAlertLevel | null {
  if (usedPercent >= STORAGE_CRITICAL) return 'critical';
  if (usedPercent >= STORAGE_HIGH) return 'high';
  if (usedPercent >= STORAGE_WARNING) return 'warning';
  return null;
}

function nodeCpuLevel(cpu: number): VirtualizationAlertLevel | null {
  if (cpu >= NODE_CPU_HIGH) return 'high';
  if (cpu >= NODE_CPU_WARNING) return 'warning';
  return null;
}

function nodeRamLevel(ratio: number): VirtualizationAlertLevel | null {
  if (ratio >= NODE_RAM_HIGH) return 'high';
  if (ratio >= NODE_RAM_WARNING) return 'warning';
  return null;
}

function isSilenced(row: IncidentRow, now: Date): boolean {
  return Boolean(row.silencedUntil && row.silencedUntil > now);
}

function shouldNotify(row: IncidentRow, signal: AlertSignal, now: Date): boolean {
  if (isSilenced(row, now)) return false;
  if (VIRTUALIZATION_ALERT_LEVEL_RANK[signal.level] < VIRTUALIZATION_ALERT_LEVEL_RANK.warning) {
    return false;
  }
  const previousRank = isLevel(row.level) ? VIRTUALIZATION_ALERT_LEVEL_RANK[row.level] : 0;
  const nextRank = VIRTUALIZATION_ALERT_LEVEL_RANK[signal.level];
  if (row.status === 'acknowledged' && nextRank <= previousRank) return false;
  if (!row.lastNotifiedAt) return true;
  if (nextRank > previousRank) return true;
  const cooldownMin = VIRTUALIZATION_ALERT_COOLDOWN_MINUTES[signal.level];
  return now.getTime() - row.lastNotifiedAt.getTime() >= cooldownMin * 60_000;
}

async function collectSignals(
  tenantId: string,
  workspaceId: string,
  settings: VirtualizationSettingsPublic
): Promise<AlertSignal[]> {
  const signals: AlertSignal[] = [];
  const dashboard = await getVirtualizationDashboard(tenantId, workspaceId);

  for (const ds of dashboard.datastores) {
    if (ds.error) {
      signals.push({
        fingerprint: `pbs:${ds.serverId}:unreachable`,
        kind: 'server_unreachable',
        level: 'critical',
        title: `PBS ${ds.serverLabel} inacessível`,
        message: ds.error,
        sourceType: 'pbs',
        sourceId: ds.serverId,
        sourceLabel: ds.serverLabel,
      });
      continue;
    }
    const level = storageLevel(ds.usedPercent);
    if (level) {
      signals.push({
        fingerprint: `pbs:${ds.serverId}:datastore:${ds.store}:usage`,
        kind: 'storage_usage',
        level,
        title: `PBS ${ds.store} a ${formatVirtualizationPercent(ds.usedPercent)}`,
        message: `${ds.serverLabel} · datastore ${ds.store}`,
        sourceType: 'pbs',
        sourceId: ds.serverId,
        sourceLabel: ds.serverLabel,
        metricValue: ds.usedPercent,
        payload: { store: ds.store },
      });
    }
  }

  if (settings.notifyOnBackupFailure) {
    for (const backup of dashboard.recentFailures) {
      signals.push({
        fingerprint: `pbs:${backup.serverId}:backup:failed:${backup.backupId}`,
        kind: 'backup_failed',
        level: 'critical',
        title: `Backup falhou · ${backup.name}`,
        message: backup.errorMessage || `${backup.serverLabel}`,
        sourceType: 'pbs',
        sourceId: backup.serverId,
        sourceLabel: backup.serverLabel,
        payload: { backupId: backup.backupId, name: backup.name },
      });
    }

    const pbsIds = new Set(dashboard.datastores.filter((ds) => !ds.error).map((ds) => ds.serverId));
    const staleCutoff = Date.now() - BACKUP_STALE_HOURS * 60 * 60 * 1000;
    for (const serverId of pbsIds) {
      const rows = dashboard.latestBackups.filter((item) => item.serverId === serverId);
      if (rows.length === 0) continue;
      const hasRecentOk = rows.some((item) => {
        if (item.status !== 'OK' || !item.backupTime) return false;
        return Date.parse(item.backupTime) >= staleCutoff;
      });
      if (hasRecentOk) continue;
      const label = rows[0]?.serverLabel ?? serverId;
      signals.push({
        fingerprint: `pbs:${serverId}:backup:stale`,
        kind: 'backup_stale',
        level: 'high',
        title: `Sem backup OK há mais de ${BACKUP_STALE_HOURS}h`,
        message: label,
        sourceType: 'pbs',
        sourceId: serverId,
        sourceLabel: label,
      });
    }
  }

  for (const pve of dashboard.pveServers) {
    if (pve.error) {
      signals.push({
        fingerprint: `pve:${pve.serverId}:unreachable`,
        kind: 'server_unreachable',
        level: 'critical',
        title: `PVE ${pve.serverLabel} inacessível`,
        message: pve.error,
        sourceType: 'pve',
        sourceId: pve.serverId,
        sourceLabel: pve.serverLabel,
      });
      continue;
    }

    const ctx = await getVirtualizationPveAlertContext(tenantId, workspaceId, pve.serverId);
    if (ctx.error) {
      signals.push({
        fingerprint: `pve:${pve.serverId}:unreachable`,
        kind: 'server_unreachable',
        level: 'critical',
        title: `PVE ${ctx.serverLabel} inacessível`,
        message: ctx.error,
        sourceType: 'pve',
        sourceId: pve.serverId,
        sourceLabel: ctx.serverLabel,
      });
      continue;
    }

    for (const node of ctx.nodes) {
      const online = node.status.toLowerCase() === 'online';
      if (!online) {
        signals.push({
          fingerprint: `pve:${pve.serverId}:node:${node.node}:offline`,
          kind: 'node_offline',
          level: 'critical',
          title: `Node ${node.node} offline`,
          message: ctx.serverLabel,
          sourceType: 'pve',
          sourceId: pve.serverId,
          sourceLabel: ctx.serverLabel,
          payload: { node: node.node, status: node.status },
        });
        continue;
      }

      const cpuRatio = node.cpu > 1 ? node.cpu / 100 : node.cpu;
      const cpuLevel = nodeCpuLevel(cpuRatio);
      if (cpuLevel) {
        signals.push({
          fingerprint: `pve:${pve.serverId}:node:${node.node}:cpu`,
          kind: 'node_cpu_high',
          level: cpuLevel,
          title: `CPU ${node.node} a ${formatVirtualizationPercent(cpuRatio * 100)}`,
          message: ctx.serverLabel,
          sourceType: 'pve',
          sourceId: pve.serverId,
          sourceLabel: ctx.serverLabel,
          metricValue: cpuRatio * 100,
          payload: { node: node.node },
        });
      }

      const ramRatio = node.maxmem > 0 ? node.mem / node.maxmem : 0;
      const ramLevel = nodeRamLevel(ramRatio);
      if (ramLevel) {
        signals.push({
          fingerprint: `pve:${pve.serverId}:node:${node.node}:ram`,
          kind: 'node_ram_high',
          level: ramLevel,
          title: `RAM ${node.node} a ${formatVirtualizationPercent(ramRatio * 100)}`,
          message: ctx.serverLabel,
          sourceType: 'pve',
          sourceId: pve.serverId,
          sourceLabel: ctx.serverLabel,
          metricValue: ramRatio * 100,
          payload: { node: node.node },
        });
      }
    }

    for (const storage of ctx.storages) {
      const status = (storage.status ?? '').toLowerCase();
      if (status && status !== 'available' && status !== 'online' && status !== 'active') {
        signals.push({
          fingerprint: `pve:${pve.serverId}:storage:${storage.storage}:unavailable`,
          kind: 'storage_unavailable',
          level: 'critical',
          title: `Storage ${storage.storage} indisponível`,
          message: `${ctx.serverLabel}${storage.node ? ` · ${storage.node}` : ''}`,
          sourceType: 'pve',
          sourceId: pve.serverId,
          sourceLabel: ctx.serverLabel,
          payload: { storage: storage.storage, status: storage.status },
        });
        continue;
      }
      const level = storageLevel(storage.usedPercent);
      if (level) {
        signals.push({
          fingerprint: `pve:${pve.serverId}:storage:${storage.storage}:usage`,
          kind: 'storage_usage',
          level,
          title: `Storage ${storage.storage} a ${formatVirtualizationPercent(storage.usedPercent)}`,
          message: `${ctx.serverLabel}${storage.node ? ` · ${storage.node}` : ''}`,
          sourceType: 'pve',
          sourceId: pve.serverId,
          sourceLabel: ctx.serverLabel,
          metricValue: storage.usedPercent,
          payload: { storage: storage.storage, node: storage.node },
        });
      }
    }

    const prefix = `guest:${pve.serverId}:`;
    const previous = await prisma.virtualizationAlertSnapshot.findMany({
      where: { workspaceId, snapshotKey: { startsWith: prefix } },
    });
    const previousMap = new Map(previous.map((row) => [row.snapshotKey, row.value]));
    const seenKeys = new Set<string>();

    for (const guest of ctx.guests) {
      const key = `${prefix}${guest.type}:${guest.vmid}`;
      seenKeys.add(key);
      const prev = previousMap.get(key);
      const nowStatus = guest.status.toLowerCase();
      if (prev === 'running' && nowStatus === 'stopped') {
        signals.push({
          fingerprint: `pve:${pve.serverId}:guest:${guest.type}:${guest.vmid}:unexpected_stop`,
          kind: 'vm_unexpected_stop',
          level: 'critical',
          title: `${guest.type === 'lxc' ? 'CT' : 'VM'} ${guest.name} parou inesperadamente`,
          message: `${ctx.serverLabel} · ${guest.node} · VMID ${guest.vmid}`,
          sourceType: 'pve',
          sourceId: pve.serverId,
          sourceLabel: ctx.serverLabel,
          payload: { guestType: guest.type, vmid: guest.vmid, name: guest.name, node: guest.node },
        });
      }
    }

    const now = new Date();
    for (const guest of ctx.guests) {
      const key = `${prefix}${guest.type}:${guest.vmid}`;
      await prisma.virtualizationAlertSnapshot.upsert({
        where: { workspaceId_snapshotKey: { workspaceId, snapshotKey: key } },
        create: {
          id: randomUUID(),
          tenantId,
          workspaceId,
          snapshotKey: key,
          value: guest.status.toLowerCase(),
          observedAt: now,
        },
        update: { value: guest.status.toLowerCase(), observedAt: now },
      });
    }
    const stale = previous.filter((row) => !seenKeys.has(row.snapshotKey));
    if (stale.length > 0) {
      await prisma.virtualizationAlertSnapshot.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
    }
  }

  return signals;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAlertLine(incident: VirtualizationAlertIncidentPublic): string {
  const mark =
    incident.level === 'critical'
      ? '🔴'
      : incident.level === 'high'
        ? '🟠'
        : incident.level === 'warning'
          ? '🟡'
          : incident.level === 'security'
            ? '🔐'
            : '🔵';
  return `${mark} ${incident.title}`;
}

async function recordEvent(
  tenantId: string,
  workspaceId: string,
  incidentId: string,
  channel: string,
  destination: string | null,
  ok: boolean,
  error?: string
) {
  await prisma.virtualizationAlertEvent.create({
    data: {
      id: randomUUID(),
      tenantId,
      workspaceId,
      incidentId,
      channel,
      destination,
      ok,
      error: error ?? null,
    },
  });
}

async function dispatchIncidents(
  tenantId: string,
  workspaceId: string,
  settings: VirtualizationSettingsPublic,
  incidents: VirtualizationAlertIncidentPublic[]
): Promise<number> {
  if (incidents.length === 0) return 0;

  for (const incident of incidents) {
    await recordEvent(tenantId, workspaceId, incident.id, 'in_app', null, true);
  }

  const subject =
    incidents.length === 1
      ? `[Virt] ${incidents[0].title}`
      : `[Virt] ${incidents.length} alertas · virtualização`;

  const whatsappBody = [
    `*Virtualização · ${incidents.length} alerta(s)*`,
    '',
    ...incidents.map((item) => formatAlertLine(item)),
    '',
    ...incidents.slice(0, 5).map((item) => `${item.sourceLabel}: ${item.message}`),
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</h2>
      <ul style="padding-left:18px;margin:0">
        ${incidents
          .map(
            (item) =>
              `<li style="margin:0 0 8px"><strong>${escapeHtml(getVirtualizationAlertLevelLabel(item.level))}</strong> — ${escapeHtml(item.title)}<br/><span style="color:#64748b;font-size:13px">${escapeHtml(item.message)}</span></li>`
          )
          .join('')}
      </ul>
    </div>
  `;

  let notified = 0;

  if (settings.notifyEmailEnabled) {
    for (const email of settings.notifyEmailAddresses) {
      try {
        await sendEmail({ tenantId, to: email, subject, html });
        notified += 1;
        for (const incident of incidents) {
          await recordEvent(tenantId, workspaceId, incident.id, 'email', email, true);
        }
      } catch (err) {
        const message =
          err instanceof EmailNotConfiguredError
            ? 'SMTP não configurado'
            : err instanceof Error
              ? err.message
              : 'Falha ao enviar email';
        for (const incident of incidents) {
          await recordEvent(tenantId, workspaceId, incident.id, 'email', email, false, message);
        }
      }
    }
  }

  if (settings.notifyWhatsappEnabled) {
    for (const phone of settings.notifyWhatsappPhones) {
      const to = formatWhatsappPhone(phone);
      try {
        await sendWhatsappMessage(tenantId, to, whatsappBody);
        notified += 1;
        for (const incident of incidents) {
          await recordEvent(tenantId, workspaceId, incident.id, 'whatsapp', to, true);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha WhatsApp';
        for (const incident of incidents) {
          await recordEvent(tenantId, workspaceId, incident.id, 'whatsapp', to, false, message);
        }
      }
    }
  }

  return notified;
}

export async function evaluateVirtualizationAlerts(
  tenantId: string,
  workspaceId: string
): Promise<{ opened: number; resolved: number; notified: number }> {
  const settings = await getVirtualizationSettings(tenantId, workspaceId);
  const now = new Date();
  const signals = await collectSignals(tenantId, workspaceId, settings);
  const active = new Set(signals.map((item) => item.fingerprint));

  const openRows = await prisma.virtualizationAlertIncident.findMany({
    where: { workspaceId, status: { not: 'resolved' } },
  });
  const matching =
    active.size > 0
      ? await prisma.virtualizationAlertIncident.findMany({
          where: { workspaceId, fingerprint: { in: [...active] } },
        })
      : [];
  const byFingerprint = new Map(matching.map((row) => [row.fingerprint, row]));
  const toNotify: VirtualizationAlertIncidentPublic[] = [];
  let opened = 0;

  for (const signal of signals) {
    const row = byFingerprint.get(signal.fingerprint);
    if (!row) {
      const created = await prisma.virtualizationAlertIncident.create({
        data: {
          id: randomUUID(),
          tenantId,
          workspaceId,
          fingerprint: signal.fingerprint,
          kind: signal.kind,
          level: signal.level,
          status: 'open',
          title: signal.title,
          message: signal.message,
          sourceType: signal.sourceType,
          sourceId: signal.sourceId,
          sourceLabel: signal.sourceLabel,
          metricValue: signal.metricValue ?? null,
          payload: (signal.payload ?? {}) as object,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      opened += 1;
      if (shouldNotify(created, signal, now)) toNotify.push(mapIncident(created));
      continue;
    }

    const reopened = row.status === 'resolved';
    const updated = await prisma.virtualizationAlertIncident.update({
      where: { id: row.id },
      data: {
        kind: signal.kind,
        level: signal.level,
        title: signal.title,
        message: signal.message,
        sourceLabel: signal.sourceLabel,
        metricValue: signal.metricValue ?? row.metricValue,
        payload: (signal.payload ?? {}) as object,
        occurrenceCount: reopened ? 1 : row.occurrenceCount + 1,
        lastSeenAt: now,
        firstSeenAt: reopened ? now : row.firstSeenAt,
        status: row.status === 'acknowledged' && !reopened ? 'acknowledged' : 'open',
        resolvedAt: null,
        lastNotifiedAt: reopened ? null : row.lastNotifiedAt,
      },
    });
    if (reopened) opened += 1;
    if (shouldNotify(updated, signal, now)) {
      toNotify.push(mapIncident(updated));
    }
  }

  const stale = openRows.filter((row) => !active.has(row.fingerprint));
  if (stale.length > 0) {
    await prisma.virtualizationAlertIncident.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { status: 'resolved', resolvedAt: now },
    });
  }

  const notified = await dispatchIncidents(tenantId, workspaceId, settings, toNotify);
  if (toNotify.length > 0) {
    await prisma.virtualizationAlertIncident.updateMany({
      where: { id: { in: toNotify.map((item) => item.id) } },
      data: { lastNotifiedAt: now },
    });
  }

  return { opened, resolved: stale.length, notified };
}

export async function listVirtualizationAlerts(
  tenantId: string,
  workspaceId: string,
  filter: 'open' | 'all' = 'open'
): Promise<VirtualizationAlertIncidentPublic[]> {
  const rows = await prisma.virtualizationAlertIncident.findMany({
    where: {
      tenantId,
      workspaceId,
      ...(filter === 'open' ? { status: { not: 'resolved' } } : {}),
    },
    orderBy: [{ lastSeenAt: 'desc' }],
    take: 100,
  });
  return rows.map(mapIncident);
}

export async function getVirtualizationAlertSummary(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationAlertSummary> {
  const rows = await prisma.virtualizationAlertIncident.findMany({
    where: { tenantId, workspaceId, status: { in: ['open', 'acknowledged'] } },
    select: { level: true, silencedUntil: true },
  });
  const now = new Date();
  const active = rows.filter((row) => !row.silencedUntil || row.silencedUntil <= now);
  const counts = { critical: 0, high: 0, warning: 0, security: 0 };
  let worst: VirtualizationAlertLevel | null = null;
  for (const row of active) {
    if (!isLevel(row.level)) continue;
    if (row.level === 'critical') counts.critical += 1;
    if (row.level === 'high') counts.high += 1;
    if (row.level === 'warning') counts.warning += 1;
    if (row.level === 'security') counts.security += 1;
    if (!worst || VIRTUALIZATION_ALERT_LEVEL_RANK[row.level] > VIRTUALIZATION_ALERT_LEVEL_RANK[worst]) {
      worst = row.level;
    }
  }
  return {
    openCount: active.length,
    ...counts,
    worstLevel: worst,
  };
}

async function loadIncident(tenantId: string, workspaceId: string, id: string) {
  const row = await prisma.virtualizationAlertIncident.findFirst({
    where: { id, tenantId, workspaceId },
  });
  if (!row) throw new Error('Alerta não encontrado');
  return row;
}

export async function acknowledgeVirtualizationAlert(
  tenantId: string,
  workspaceId: string,
  id: string
): Promise<VirtualizationAlertIncidentPublic> {
  await loadIncident(tenantId, workspaceId, id);
  const row = await prisma.virtualizationAlertIncident.update({
    where: { id },
    data: { status: 'acknowledged', acknowledgedAt: new Date() },
  });
  return mapIncident(row);
}

export async function silenceVirtualizationAlert(
  tenantId: string,
  workspaceId: string,
  id: string,
  hours = 24
): Promise<VirtualizationAlertIncidentPublic> {
  await loadIncident(tenantId, workspaceId, id);
  const until = new Date(Date.now() + Math.max(1, hours) * 60 * 60 * 1000);
  const row = await prisma.virtualizationAlertIncident.update({
    where: { id },
    data: { status: 'silenced', silencedUntil: until },
  });
  return mapIncident(row);
}

export async function resolveVirtualizationAlert(
  tenantId: string,
  workspaceId: string,
  id: string
): Promise<VirtualizationAlertIncidentPublic> {
  await loadIncident(tenantId, workspaceId, id);
  const row = await prisma.virtualizationAlertIncident.update({
    where: { id },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
  return mapIncident(row);
}

export async function sendVirtualizationAlertTest(
  tenantId: string,
  workspaceId: string
): Promise<{ email: number; whatsapp: number }> {
  const settings = await getVirtualizationSettings(tenantId, workspaceId);
  const sample: VirtualizationAlertIncidentPublic = {
    id: 'test',
    fingerprint: 'test',
    kind: 'backup_failed',
    level: 'notice',
    status: 'open',
    title: 'Alerta de teste · virtualização',
    message: 'O sistema de notificações está configurado correctamente.',
    sourceType: 'app',
    sourceId: null,
    sourceLabel: 'Teste',
    metricValue: null,
    occurrenceCount: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    lastNotifiedAt: null,
    acknowledgedAt: null,
    silencedUntil: null,
    resolvedAt: null,
  };

  const subject = `[Virt] ${sample.title}`;
  const html = `<p>${escapeHtml(sample.message)}</p>`;
  const whatsappBody = `*${subject}*\n\n${sample.message}`;
  let email = 0;
  let whatsapp = 0;

  if (settings.notifyEmailEnabled) {
    for (const to of settings.notifyEmailAddresses) {
      await sendEmail({ tenantId, to, subject, html });
      email += 1;
    }
  }
  if (settings.notifyWhatsappEnabled) {
    for (const phone of settings.notifyWhatsappPhones) {
      await sendWhatsappMessage(tenantId, formatWhatsappPhone(phone), whatsappBody);
      whatsapp += 1;
    }
  }
  if (!email && !whatsapp) {
    throw new Error('Active email ou WhatsApp e indique destinos nas definições');
  }
  return { email, whatsapp };
}

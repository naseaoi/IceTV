import 'server-only';

import { promises as fs } from 'fs';
import path from 'path';

import { getConfigForRead } from '@/lib/config';
import {
  type HostTrafficStatus,
  type TrafficSnapshot,
  computeHostTrafficStatus,
  normalizeTrafficSettings,
  parseVnstatDaily,
} from '@/lib/host-traffic';
import { SERVER_RELAY_PAUSED_HEADER } from '@/lib/server-relay';
import type { AdminConfig } from '@/types/admin';

const SNAPSHOT_CACHE_MS = 30_000;
const MAX_STATS_FILE_BYTES = 1024 * 1024;

let snapshotCache: { at: number; snapshot: TrafficSnapshot | null } | null =
  null;
let snapshotInflight: Promise<TrafficSnapshot | null> | null = null;
let snapshotGeneration = 0;

function getStatsFilePath(): string {
  const configured = process.env.HOST_TRAFFIC_FILE?.trim();
  if (configured) return configured;
  return process.env.DOCKER_ENV
    ? '/data/host-traffic.json'
    : path.resolve(process.cwd(), 'data', 'host-traffic.json');
}

async function loadSnapshot(): Promise<TrafficSnapshot | null> {
  const filePath = getStatsFilePath();
  let handle: fs.FileHandle | null = null;
  try {
    // 检查与读取用同一句柄，导出脚本原子替换文件时也不会读到另一份
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_STATS_FILE_BYTES) return null;
    const buffer = Buffer.alloc(MAX_STATS_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_STATS_FILE_BYTES) return null;
    const parsed = parseVnstatDaily(
      JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')),
    );
    if (!parsed) return null;
    return {
      days: parsed.days,
      updatedAt: parsed.updatedAt ?? stat.mtimeMs,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[host-traffic] 读取流量统计失败:', error);
    }
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function getSnapshot(now: number): Promise<TrafficSnapshot | null> {
  if (snapshotCache && now - snapshotCache.at < SNAPSHOT_CACHE_MS) {
    return snapshotCache.snapshot;
  }
  if (snapshotInflight) return snapshotInflight;
  const generation = snapshotGeneration;
  const task = loadSnapshot()
    .then((snapshot) => {
      if (generation === snapshotGeneration)
        snapshotCache = { at: now, snapshot };
      return snapshot;
    })
    .finally(() => {
      if (snapshotInflight === task) snapshotInflight = null;
    });
  snapshotInflight = task;
  return task;
}

export function resetHostTrafficCache(): void {
  snapshotGeneration += 1;
  snapshotCache = null;
  snapshotInflight = null;
}

export async function getHostTrafficStatus(
  config?: Readonly<AdminConfig>,
  now = Date.now(),
): Promise<HostTrafficStatus> {
  const resolvedConfig = config ?? (await getConfigForRead());
  return computeHostTrafficStatus({
    snapshot: await getSnapshot(now),
    settings: normalizeTrafficSettings(resolvedConfig.TrafficConfig),
    now,
  });
}

// 中转保护不能因统计异常反过来挡住播放，出错一律放行
export async function isServerRelayPaused(
  config?: Readonly<AdminConfig>,
): Promise<boolean> {
  try {
    return (await getHostTrafficStatus(config)).relay === 'paused';
  } catch (error) {
    console.warn('[host-traffic] 判断中转状态失败:', error);
    return false;
  }
}

export function serverRelayPausedResponse(): Response {
  return new Response(JSON.stringify({ error: '服务器中转已暂停' }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': '3600',
      [SERVER_RELAY_PAUSED_HEADER]: '1',
      'Access-Control-Expose-Headers': SERVER_RELAY_PAUSED_HEADER,
    },
  });
}

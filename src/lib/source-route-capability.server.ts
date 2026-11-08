import 'server-only';

import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import {
  type SourceProxyMode,
  DEFAULT_SOURCE_PROXY_MODE,
} from '@/lib/proxy-modes';
import { responseAllowsCors } from '@/lib/source-capability';
import { fetchWithUrlGuard } from '@/lib/url-guard';
import { resolveUrl } from '@/lib/url-resolve';

export type SourceDirectBlockReason = 'cors' | 'mixed-content';

export interface SourceRouteCapability {
  direct: 'ok' | 'blocked';
  reason?: SourceDirectBlockReason;
  checkedAt: number;
}

export type SourceRouteCapabilities = Record<string, SourceRouteCapability>;

// 所有源合存一条共享缓存记录，接口一次读取即可得到全部源的结论
const SHARED_KEY = 'source-route-capability:v1';
const SHARED_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;
const REPROBE_AFTER_MS = 6 * 60 * 60 * 1000;
// 含未得出结论的尝试；按实例节流，避免上游异常时每次清单请求都探测
const PROBE_ATTEMPT_INTERVAL_MS = 30 * 60 * 1000;
const READ_SNAPSHOT_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 8_000;
const WRITE_LEASE_MS = 5_000;
const WRITE_LEASE_ATTEMPTS = 3;
const MAX_TRACKED_SOURCES = 500;

let snapshot: { value: SourceRouteCapabilities; expiresAt: number } | null =
  null;
let readInflight: Promise<SourceRouteCapabilities> | null = null;
const probeAttempts = new Map<string, number>();

function isCapability(value: unknown): value is SourceRouteCapability {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (entry.direct !== 'ok' && entry.direct !== 'blocked') return false;
  if (
    entry.reason !== undefined &&
    entry.reason !== 'cors' &&
    entry.reason !== 'mixed-content'
  )
    return false;
  return (
    typeof entry.checkedAt === 'number' && Number.isFinite(entry.checkedAt)
  );
}

function parseCapabilities(
  raw: string | undefined | null,
  now: number,
): SourceRouteCapabilities {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: SourceRouteCapabilities = {};
    if (!parsed || typeof parsed !== 'object') return result;
    for (const [source, entry] of Object.entries(parsed)) {
      if (isCapability(entry) && now - entry.checkedAt < CAPABILITY_TTL_MS) {
        result[source] = entry;
      }
    }
    return result;
  } catch {
    return {};
  }
}

async function readSharedCapabilities(): Promise<SourceRouteCapabilities> {
  const now = Date.now();
  const record = await db.getSharedCache(SHARED_KEY);
  if (!record || record.staleUntil <= now) return {};
  return parseCapabilities(record.value, now);
}

export async function getSourceRouteCapabilities(): Promise<SourceRouteCapabilities> {
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot.value;
  if (!readInflight) {
    readInflight = readSharedCapabilities()
      .catch(() => snapshot?.value ?? {})
      .then((value) => {
        snapshot = { value, expiresAt: Date.now() + READ_SNAPSHOT_TTL_MS };
        return value;
      })
      .finally(() => {
        readInflight = null;
      });
  }
  return readInflight;
}

async function writeCapability(
  source: string,
  capability: SourceRouteCapability,
): Promise<void> {
  const local = { ...(snapshot?.value ?? {}), [source]: capability };
  snapshot = { value: local, expiresAt: Date.now() + READ_SNAPSHOT_TTL_MS };

  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < WRITE_LEASE_ATTEMPTS; attempt++) {
    const now = Date.now();
    if (
      await db.acquireSharedCacheLease(
        SHARED_KEY,
        token,
        now,
        now + WRITE_LEASE_MS,
      )
    ) {
      acquired = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  if (!acquired) return;

  try {
    const now = Date.now();
    const record = await db.getSharedCache(SHARED_KEY);
    const merged = {
      ...parseCapabilities(
        record && record.staleUntil > now ? record.value : null,
        now,
      ),
      [source]: capability,
    };
    await db.setSharedCache(
      SHARED_KEY,
      token,
      JSON.stringify(merged),
      now + SHARED_RECORD_TTL_MS,
      now + SHARED_RECORD_TTL_MS,
      now,
    );
    snapshot = { value: merged, expiresAt: now + READ_SNAPSHOT_TTL_MS };
  } finally {
    await db.releaseSharedCacheLease(SHARED_KEY, token).catch(() => {});
  }
}

// 取中间位置的分片，片头常是来自其他主机的广告
export function pickProbeSegmentUrl(
  content: string,
  playlistUrl: string,
): string | null {
  if (content.includes('#EXT-X-STREAM-INF')) return null;
  const segments = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (segments.length === 0) return null;
  const resolved = resolveUrl(
    playlistUrl,
    segments[Math.floor(segments.length / 2)],
  );
  return /^https?:\/\//i.test(resolved) ? resolved : null;
}

function isMixedContent(pageOrigin: URL, targetUrl: string): boolean {
  try {
    return (
      pageOrigin.protocol === 'https:' &&
      new URL(targetUrl).protocol === 'http:'
    );
  } catch {
    return false;
  }
}

// 只在能确定浏览器必然失败或必然放行时给出结论；上游错误、超时或额度不足返回 null
export async function probeSourceDirectCapability({
  segmentUrl,
  pageOrigin,
  userAgent,
}: {
  segmentUrl: string;
  pageOrigin: string;
  userAgent: string;
}): Promise<SourceRouteCapability | null> {
  const page = new URL(pageOrigin);
  const checkedAt = Date.now();
  if (isMixedContent(page, segmentUrl)) {
    return { direct: 'blocked', reason: 'mixed-content', checkedAt };
  }

  let response: Response;
  try {
    response = await fetchWithUrlGuard(segmentUrl, {
      headers: {
        'User-Agent': userAgent,
        Origin: page.origin,
        Referer: `${page.origin}/`,
        Range: 'bytes=0-1023',
      },
      redirect: 'follow',
      timeoutMs: PROBE_TIMEOUT_MS,
      resourceContext: { kind: 'probe' },
    });
  } catch {
    return null;
  }

  try {
    if (!response.ok) return null;
    if (response.url && isMixedContent(page, response.url)) {
      return { direct: 'blocked', reason: 'mixed-content', checkedAt };
    }
    return responseAllowsCors(response.headers, page.origin)
      ? { direct: 'ok', checkedAt }
      : { direct: 'blocked', reason: 'cors', checkedAt };
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}

function resolvePageOrigin(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function scheduleSourceDirectProbe({
  source,
  playlistContent,
  playlistUrl,
  referer,
  userAgent,
}: {
  source: string | null;
  playlistContent: string;
  playlistUrl: string;
  referer: string | null;
  userAgent: string;
}): void {
  if (!source) return;
  const pageOrigin = resolvePageOrigin(referer);
  if (!pageOrigin) return;
  const now = Date.now();
  const lastAttempt = probeAttempts.get(source);
  if (
    lastAttempt !== undefined &&
    now - lastAttempt < PROBE_ATTEMPT_INTERVAL_MS
  )
    return;
  const segmentUrl = pickProbeSegmentUrl(playlistContent, playlistUrl);
  if (!segmentUrl) return;

  if (probeAttempts.size >= MAX_TRACKED_SOURCES && !probeAttempts.has(source)) {
    const oldest = probeAttempts.keys().next().value;
    if (oldest !== undefined) probeAttempts.delete(oldest);
  }
  probeAttempts.set(source, now);

  void (async () => {
    const known = (await getSourceRouteCapabilities())[source];
    if (known && Date.now() - known.checkedAt < REPROBE_AFTER_MS) return;
    const capability = await probeSourceDirectCapability({
      segmentUrl,
      pageOrigin,
      userAgent,
    });
    if (capability) await writeCapability(source, capability);
  })().catch((error) => {
    console.warn('源站直连能力检测失败', { source, error });
  });
}

export function isSourceDirectBlocked(
  capabilities: SourceRouteCapabilities,
  source: string,
): boolean {
  return capabilities[source]?.direct === 'blocked';
}

// 「直连」「代理」是站长显式选择；只有「自动」会被检测结论改写为代理
export function resolveSourceRoute(
  proxyMode: SourceProxyMode | undefined,
  capabilities: SourceRouteCapabilities,
  source: string,
): SourceProxyMode {
  const mode = proxyMode || DEFAULT_SOURCE_PROXY_MODE;
  return mode === 'auto' && isSourceDirectBlocked(capabilities, source)
    ? 'server'
    : mode;
}

export function resetSourceRouteCapabilityForTests(): void {
  snapshot = null;
  readInflight = null;
  probeAttempts.clear();
}

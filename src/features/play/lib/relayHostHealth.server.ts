import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createThrottledMaintenance } from '@/lib/concurrency';
import { db } from '@/lib/db';
import { ProxyRouteError } from '@/lib/proxy-diagnostics';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { SHARED_CACHE_PRUNE_BATCH_SIZE } from '@/lib/shared-cache-maintenance';

export const RELAY_FAILURE_TTL_MS = 10 * 60 * 1000;
export type RelayHostFailureReason = 'host-forbidden' | 'host-connection';
type Failure = { reason: RelayHostFailureReason; until: number };
type HostState = {
  failure: Failure | null;
  forbiddenPaths: string[];
  until: number;
};
const FORBIDDEN_PATH_THRESHOLD = 3;
const fallback = new Map<string, HostState>();
const prune = createThrottledMaintenance(60_000);

function keyFor(url: string, isLive: boolean): string {
  const target = new URL(url);
  const host = `${target.hostname}:${target.port || (target.protocol === 'https:' ? '443' : '80')}`;
  // 直播不使用代理池，与点播出口隔离；同出口类别内跨用户、源和 URL 共享。
  return `relay-host-v2:${isLive ? 'live' : 'vod'}:${createHash('sha256').update(host).digest('hex')}`;
}

function rememberLocalState(key: string, state: HostState | null) {
  fallback.delete(key);
  if (state) fallback.set(key, state);
  while (fallback.size > 512) fallback.delete(fallback.keys().next().value!);
}

async function readSharedState(key: string): Promise<HostState | null> {
  const record = await db.getSharedCache(key);
  if (!record?.value || record.freshUntil <= Date.now()) return null;
  const state: HostState | null = JSON.parse(record.value);
  return state && state.until > Date.now() ? state : null;
}

export async function readRelayHostFailure(
  url: string,
  isLive: boolean,
): Promise<Failure | null> {
  const key = keyFor(url, isLive);
  try {
    const state = await readSharedState(key);
    rememberLocalState(key, state);
    return state?.failure ?? null;
  } catch (error) {
    console.warn('读取中转主机冷却失败，使用本机记忆', error);
    const state = fallback.get(key);
    if (state && state.until > Date.now()) return state.failure;
    fallback.delete(key);
    return null;
  }
}

function nextHostState(
  previous: HostState | null,
  url: string,
  reason: RelayHostFailureReason | null,
): HostState | null {
  if (!reason) return null;
  const now = Date.now();
  if (reason === 'host-connection') {
    const until = now + RELAY_FAILURE_TTL_MS;
    return { failure: { reason, until }, forbiddenPaths: [], until };
  }
  const active = previous && previous.until > now ? previous : null;
  if (active?.failure) return active;
  // 查询参数中的签名变化仍算同一个 URL，路径只存哈希且最多保留阈值条目。
  const path = createHash('sha256').update(new URL(url).pathname).digest('hex');
  const forbiddenPaths = Array.from(
    new Set([...(active?.forbiddenPaths ?? []), path]),
  ).slice(0, FORBIDDEN_PATH_THRESHOLD);
  const failure =
    forbiddenPaths.length >= FORBIDDEN_PATH_THRESHOLD
      ? { reason, until: now + RELAY_FAILURE_TTL_MS }
      : null;
  return {
    failure,
    forbiddenPaths,
    until: failure?.until ?? active?.until ?? now + RELAY_FAILURE_TTL_MS,
  };
}

export async function recordRelayHostResult(
  url: string,
  isLive: boolean,
  reason: RelayHostFailureReason | null,
): Promise<Failure | null> {
  const key = keyFor(url, isLive);
  const token = randomUUID();
  try {
    if (!reason && !(await readSharedState(key))) {
      rememberLocalState(key, null);
      return null;
    }
    // 在租约内读取并合并路径，避免跨用户并发 403 覆盖彼此的证据。
    let acquired = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const now = Date.now();
      acquired = await db.acquireSharedCacheLease(key, token, now, now + 5000);
      if (acquired) break;
      await delay(25);
    }
    if (!acquired) throw new Error('Relay host state lease unavailable');
    let state: HostState | null;
    try {
      state = nextHostState(await readSharedState(key), url, reason);
      const now = Date.now();
      // 成功写空值墓碑，同时解除主机冷却与未达阈值的 403 计数。
      const saved = await db.setSharedCache(
        key,
        token,
        JSON.stringify(state),
        state?.until ?? now,
        state?.until ?? now,
        now,
      );
      if (!saved) throw new Error('Relay host state lease lost');
      rememberLocalState(key, state);
    } finally {
      await db.releaseSharedCacheLease(key, token);
    }
    prune(() => db.pruneSharedCache(Date.now(), SHARED_CACHE_PRUNE_BATCH_SIZE));
    return state?.failure ?? null;
  } catch (error) {
    console.warn('保存中转主机冷却失败，保留本机记忆', error);
    const state = nextHostState(fallback.get(key) ?? null, url, reason);
    rememberLocalState(key, state);
    return state?.failure ?? null;
  }
}

export function classifyRelayHostFailure(
  error: unknown,
): RelayHostFailureReason | null {
  if (error instanceof ResourceLimitError) return null;
  if (error instanceof ProxyRouteError) {
    if (error.diagnostic.upstreamErrorType === 'EMPTY_RESPONSE')
      return 'host-connection';
    if (
      error.diagnostic.reason === 'upstream-http' &&
      error.diagnostic.upstreamStatus === 403
    )
      return 'host-forbidden';
    if (
      error.diagnostic.reason === 'upstream-http' &&
      error.diagnostic.upstreamStatus === 444
    )
      return 'host-connection';
    return null;
  }
  if (
    !(error instanceof Error) ||
    error.name === 'AbortError' ||
    error.name === 'UrlValidationError'
  )
    return null;
  const cause = error as Error & {
    cause?: { code?: string; message?: string };
    code?: string;
  };
  const detail = `${cause.code || ''} ${cause.cause?.code || ''} ${cause.message} ${cause.cause?.message || ''}`;
  return /ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_SOCKET|ERR_SSL|CERT|VERIFY_LEAF_SIGNATURE|TLS|socket hang up|other side closed|empty reply/i.test(
    detail,
  )
    ? 'host-connection'
    : null;
}

export class RelayHostUnavailableError extends ProxyRouteError {
  constructor(
    readonly failure: Failure,
    url: string,
    source: string | null,
    isLive: boolean,
    readonly cached: boolean,
  ) {
    super({
      route: 'm3u8',
      source,
      targetUrl: url,
      isLive,
      stage: 'upstream',
      reason:
        failure.reason === 'host-forbidden'
          ? 'upstream-http'
          : 'upstream-fetch',
      upstreamStatus: failure.reason === 'host-forbidden' ? 403 : undefined,
      status: failure.reason === 'host-forbidden' ? 403 : 502,
    });
  }
}

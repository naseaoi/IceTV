import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';

export type ServerProxyKind =
  | 'douban-data'
  | 'douban-image'
  | 'bangumi-data'
  | 'vod-segment'
  | 'vod-m3u8';

type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type FailureStats = {
  count: number;
  firstAt: number;
  lastAt: number;
  lastReason: string;
};

const RATE_LIMITS: Record<ServerProxyKind, RateLimitConfig> = {
  'douban-data': { maxRequests: 120, windowMs: 60_000 },
  'douban-image': { maxRequests: 480, windowMs: 60_000 },
  'bangumi-data': { maxRequests: 60, windowMs: 60_000 },
  // 分片与清单按正常播放的数倍留量，只拦异常循环与外部盗链
  'vod-segment': { maxRequests: 1200, windowMs: 60_000 },
  'vod-m3u8': { maxRequests: 240, windowMs: 60_000 },
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const failureStats = new Map<string, FailureStats>();
const MAX_BUCKETS = 5000;

export function requireServerProxyQuota(
  kind: ServerProxyKind,
  request: NextRequest,
  username?: string,
): NextResponse | null {
  pruneRateLimitBuckets();

  const config = RATE_LIMITS[kind];
  const key = getRateLimitKey(kind, request, username);
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return null;
  }

  bucket.count += 1;
  if (bucket.count <= config.maxRequests) {
    return null;
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1000),
  );
  return NextResponse.json(
    { error: '请求过于频繁，请稍后再试' },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': retryAfterSeconds.toString(),
      },
    },
  );
}

export function recordServerProxyFailure(
  kind: ServerProxyKind,
  reason: unknown,
): void {
  const key = kind;
  const now = Date.now();
  const previous = failureStats.get(key);
  const lastReason = normalizeFailureReason(reason);
  const nextStats: FailureStats = previous
    ? {
        count: previous.count + 1,
        firstAt: previous.firstAt,
        lastAt: now,
        lastReason,
      }
    : {
        count: 1,
        firstAt: now,
        lastAt: now,
        lastReason,
      };

  failureStats.set(key, nextStats);
  console.warn('[server-proxy.failure]', {
    kind,
    count: nextStats.count,
    windowSeconds: Math.ceil((nextStats.lastAt - nextStats.firstAt) / 1000),
    reason: lastReason,
  });
}

function getRateLimitKey(
  kind: ServerProxyKind,
  request: NextRequest,
  username?: string,
): string {
  if (username) {
    return `${kind}:user:${username}`;
  }

  return `${kind}:ip:${getClientIp(request)}`;
}

function pruneRateLimitBuckets(): void {
  if (rateLimitBuckets.size <= MAX_BUCKETS) {
    return;
  }

  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }

  if (rateLimitBuckets.size <= MAX_BUCKETS) {
    return;
  }

  const overflow = rateLimitBuckets.size - MAX_BUCKETS;
  for (const key of Array.from(rateLimitBuckets.keys()).slice(0, overflow)) {
    rateLimitBuckets.delete(key);
  }
}

function normalizeFailureReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }

  if (typeof reason === 'string') {
    return reason;
  }

  try {
    return JSON.stringify(reason);
  } catch {
    return 'unknown';
  }
}

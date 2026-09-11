import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import {
  consumeSharedQuota,
  resourceKey,
  sharedResourceStore,
} from '@/lib/shared-resource-quota.server';

export type ServerProxyKind =
  | 'douban-data'
  | 'douban-image'
  | 'bangumi-data'
  | 'danmaku'
  | 'vod-segment'
  | 'vod-m3u8';

type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
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
  // 上游 comment 接口限流严格，本站缓存兜底后按换集频率留量
  danmaku: { maxRequests: 30, windowMs: 60_000 },
  // 分片与清单按正常播放的数倍留量，只拦异常循环与外部盗链
  'vod-segment': { maxRequests: 1200, windowMs: 60_000 },
  'vod-m3u8': { maxRequests: 240, windowMs: 60_000 },
};

const failureStats = new Map<string, FailureStats>();

export async function requireServerProxyQuota(
  kind: ServerProxyKind,
  request: NextRequest,
  username?: string,
): Promise<Response | null> {
  const config = RATE_LIMITS[kind];
  const key = getRateLimitKey(kind, request, username);
  try {
    await consumeSharedQuota(
      await sharedResourceStore(),
      resourceKey('proxy', key),
      1,
      config.maxRequests,
      429,
    );
    return null;
  } catch (error) {
    return (
      resourceLimitResponse(error) ??
      NextResponse.json(
        { error: '服务繁忙，请稍后重试' },
        { status: 503, headers: { 'Retry-After': '1' } },
      )
    );
  }
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

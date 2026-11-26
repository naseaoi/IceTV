import 'server-only';

import type {
  LiveLineHealth,
  LiveLineHealthReason,
} from '@/features/live/types';
import { isServerRelayPaused } from '@/lib/host-traffic.server';
import {
  fetchStreamThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { ResponseSizeLimitError } from '@/lib/proxy-response-limits';
import {
  ResourceLimitError,
  UpstreamCooldownError,
} from '@/lib/server-resource-errors';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

import {
  LIVE_HEALTH_IDENTITY,
  LIVE_HEALTH_POLICY as POLICY,
} from './liveHealthPolicy';

class ProbeFailure extends Error {
  constructor(readonly reason: LiveLineHealthReason) {
    super(reason);
  }
}
export class LiveHealthDeferred extends Error {}

type ConnectionFailureReason = 'timeout' | 'unreachable';
class ProbeConnectionFailure extends ProbeFailure {
  constructor(readonly reason: ConnectionFailureReason) {
    super(reason);
  }
}
class ProbeHostShortCircuited extends ProbeConnectionFailure {}

function connectionFailureReason(error: unknown): ConnectionFailureReason {
  return error instanceof Error &&
    ['AbortError', 'TimeoutError'].includes(error.name)
    ? 'timeout'
    : 'unreachable';
}

type ProbeBody = {
  text: string;
  finalUrl: string;
  latencyMs: number;
  truncated: boolean;
};

// 按每个请求的最大正文预扣且不退还，失败、重定向和代理回退也占预算。
export function createLiveHealthBudget(
  maxBytes: number = POLICY.roundMaxBytes,
) {
  let reservedBytes = 0;
  return {
    get reservedBytes() {
      return reservedBytes;
    },
    reserve(bytes: number) {
      if (reservedBytes + bytes > maxBytes)
        throw new LiveHealthDeferred('byte budget');
      reservedBytes += bytes;
    },
  };
}

// 锁覆盖正文消费；重定向逐跳重新排队，跨源共用 CDN 也保持串行。
export function createLiveHealthHostGate() {
  const tails = new Map<string, Promise<void>>();
  const failures = new Map<
    string,
    { count: number; reason: ConnectionFailureReason }
  >();
  return async function withHost<T>(
    url: string,
    work: (onResponse: () => void) => Promise<T>,
  ): Promise<T> {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    const previous = tails.get(host) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(host, current);
    await previous;
    try {
      const failure = failures.get(host);
      if (failure && failure.count >= POLICY.hostConnectionFailureLimit) {
        throw new ProbeHostShortCircuited(failure.reason);
      }
      try {
        return await work(() => failures.delete(host));
      } catch (error) {
        if (error instanceof ProbeConnectionFailure) {
          failures.set(host, {
            count: (failures.get(host)?.count ?? 0) + 1,
            reason: error.reason,
          });
        }
        throw error;
      }
    } finally {
      release();
      if (tails.get(host) === current) tails.delete(host);
    }
  };
}

export type LiveHealthProbeContext = {
  budget: ReturnType<typeof createLiveHealthBudget>;
  withHost: ReturnType<typeof createLiveHealthHostGate>;
  signal: AbortSignal;
};

async function requestBody(
  initialUrl: string,
  ua: string,
  segment: boolean,
  context: LiveHealthProbeContext,
): Promise<ProbeBody> {
  const maxBytes = segment
    ? POLICY.segmentSampleBytes
    : POLICY.playlistMaxBytes;
  let url = initialUrl;
  for (let redirects = 0; redirects <= POLICY.maxRedirects; redirects++) {
    const result = await context.withHost<{ redirect: string } | ProbeBody>(
      url,
      async (onResponse) => {
        const controller = new AbortController();
        const timeout = setTimeout(
          () =>
            controller.abort(
              Object.assign(new Error('Timed out'), { name: 'TimeoutError' }),
            ),
          POLICY.requestTimeoutMs,
        );
        const signal = AbortSignal.any([context.signal, controller.signal]);
        const startedAt = Date.now();
        try {
          signal.throwIfAborted();
          if (await isServerRelayPaused())
            throw new LiveHealthDeferred('relay paused');
          signal.throwIfAborted();
          const headers: Record<string, string> = {
            'User-Agent': ua,
            'Accept-Encoding': 'identity',
            ...(segment ? { Range: `bytes=0-${maxBytes - 1}` } : {}),
          };
          const resourceContext = {
            identity: LIVE_HEALTH_IDENTITY,
            ...(segment ? { kind: 'live' as const } : {}),
          };
          let response: Response | undefined;
          const proxy = getProxyUrlForTarget(new URL(url));
          if (proxy) {
            const validation = await validateProxyUrlForRequest(url);
            if (!validation.ok) throw new UrlValidationError(validation.reason);
            context.budget.reserve(maxBytes);
            try {
              const upstream = await fetchStreamThroughProxy(
                new URL(url),
                proxy,
                {
                  userAgent: ua,
                  headers,
                  accept: '*/*',
                  timeoutMs: POLICY.requestTimeoutMs,
                  // 采样读取负责截断；上游忽略 Range 时仍能读到首块后主动取消。
                  maxBytes: POLICY.roundMaxBytes,
                  signal,
                  resourceContext,
                },
              );
              onResponse();
              response = new Response(upstream.body, {
                status: upstream.status,
                headers: upstream.headers,
              });
              const encoding = response.headers.get('content-encoding');
              if (encoding && encoding !== 'identity') {
                await response.body?.cancel();
                response = undefined;
              }
            } catch (error) {
              if (error instanceof ResourceLimitError || signal.aborted)
                throw error;
              // 与直播播放一致：环境代理失败后回落到受保护的 Fetch。
            }
          }
          if (!response) {
            signal.throwIfAborted();
            context.budget.reserve(maxBytes);
            response = await fetchWithUrlGuard(url, {
              headers,
              cache: 'no-store',
              redirect: 'manual',
              useProxyPool: false,
              timeoutMs: POLICY.requestTimeoutMs,
              signal,
              resourceContext,
            });
            onResponse();
          }
          let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
          try {
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              const location = response.headers.get('location');
              if (location)
                return { redirect: new URL(location, url).toString() };
            }
            if (!response.ok)
              throw new ProbeFailure(
                response.status === 403
                  ? 'forbidden'
                  : [404, 410].includes(response.status)
                    ? 'not_found'
                    : 'http_error',
              );
            if (!response.body)
              throw new ProbeFailure(
                segment ? 'segment_failed' : 'invalid_playlist',
              );
            reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let total = 0;
            let latencyMs = 0;
            let truncated = false;
            while (true) {
              signal.throwIfAborted();
              const { done, value } = await reader.read();
              if (done) break;
              if (!total && value.byteLength)
                latencyMs = Date.now() - startedAt;
              truncated = !segment && total + value.byteLength > maxBytes;
              const chunk = value.subarray(0, maxBytes - total);
              total += chunk.byteLength;
              if (!segment) chunks.push(chunk);
              if (truncated || (segment && total >= maxBytes)) break;
            }
            if (!total)
              throw new ProbeFailure(
                segment ? 'segment_failed' : 'invalid_playlist',
              );
            return {
              text: segment ? '' : Buffer.concat(chunks).toString('utf8'),
              finalUrl: response.url || url,
              latencyMs,
              truncated,
            };
          } finally {
            if (reader) await reader.cancel().catch(() => {});
            else await response.body?.cancel().catch(() => {});
          }
        } catch (error) {
          if (error instanceof UpstreamCooldownError && error.responseReceived)
            onResponse();
          if (context.signal.aborted) throw error;
          if (controller.signal.aborted)
            throw new ProbeConnectionFailure('timeout');
          if (
            error instanceof ResourceLimitError ||
            error instanceof LiveHealthDeferred ||
            error instanceof ProbeFailure ||
            error instanceof ResponseSizeLimitError ||
            error instanceof UrlValidationError
          )
            throw error;
          throw new ProbeConnectionFailure(connectionFailureReason(error));
        } finally {
          clearTimeout(timeout);
        }
      },
    );
    if ('redirect' in result) {
      url = result.redirect;
      continue;
    }
    return result;
  }
  throw new ProbeFailure('unreachable');
}

function playlistLines(text: string, truncated: boolean): string[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    lines[0] !== '#EXTM3U' ||
    (truncated && !lines.some((line) => line.startsWith('#EXTINF:')))
  )
    throw new ProbeFailure('invalid_playlist');
  return lines;
}

function hasHistoricalLatestSegment(lines: string[]): boolean {
  let nextStart: number | undefined;
  let latestStart: number | undefined;
  let duration: number | undefined;
  let awaitingSegment = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const parsed = Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length));
      nextStart = Number.isFinite(parsed) ? parsed : undefined;
    } else if (line === '#EXT-X-DISCONTINUITY') {
      nextStart = undefined;
    } else if (line.startsWith('#EXTINF:')) {
      const parsed = Number.parseFloat(line.slice('#EXTINF:'.length));
      duration =
        Number.isFinite(parsed) && parsed >= 0 ? parsed * 1000 : undefined;
      awaitingSegment = true;
    } else if (!line.startsWith('#') && awaitingSegment) {
      latestStart = nextStart;
      // PROGRAM-DATE-TIME 可只标首片；沿 EXTINF 推进，避免把跨日长节目误判为历史。
      nextStart =
        nextStart !== undefined && duration !== undefined
          ? nextStart + duration
          : undefined;
      awaitingSegment = false;
    }
  }
  return (
    latestStart !== undefined &&
    Date.now() - latestStart > POLICY.endedProgramAgeMs
  );
}

export async function probeLiveLine(
  url: string,
  ua: string,
  context: LiveHealthProbeContext,
): Promise<LiveLineHealth | null> {
  let segment = false;
  let latencyMs: number | undefined;
  try {
    let playlist = await requestBody(url, ua, false, context);
    latencyMs = playlist.latencyMs;
    let lines = playlistLines(playlist.text, playlist.truncated);
    if (playlist.truncated)
      return { status: 'ended', checkedAt: Date.now(), latencyMs };
    const master = lines.findIndex((line) =>
      line.startsWith('#EXT-X-STREAM-INF:'),
    );
    if (master >= 0) {
      const variant = lines
        .slice(master + 1)
        .find((line) => !line.startsWith('#'));
      if (!variant) throw new ProbeFailure('invalid_playlist');
      playlist = await requestBody(
        new URL(variant, playlist.finalUrl).toString(),
        ua,
        false,
        context,
      );
      latencyMs = Math.max(latencyMs, playlist.latencyMs);
      lines = playlistLines(playlist.text, playlist.truncated);
      if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:')))
        throw new ProbeFailure('invalid_playlist');
    }
    if (
      playlist.truncated ||
      lines.includes('#EXT-X-ENDLIST') ||
      hasHistoricalLatestSegment(lines)
    )
      return { status: 'ended', checkedAt: Date.now(), latencyMs };
    if (!lines.some((line) => line.startsWith('#EXTINF:')))
      throw new ProbeFailure('invalid_playlist');
    const latest = lines.filter((line) => !line.startsWith('#')).at(-1);
    if (!latest) throw new ProbeFailure('invalid_playlist');
    segment = true;
    await requestBody(
      new URL(latest, playlist.finalUrl).toString(),
      ua,
      true,
      context,
    );
    return {
      status: latencyMs <= POLICY.slowMs ? 'ok' : 'slow',
      checkedAt: Date.now(),
      latencyMs,
    };
  } catch (error) {
    if (
      error instanceof ResourceLimitError ||
      error instanceof LiveHealthDeferred ||
      context.signal.aborted
    )
      return null;
    const reason =
      error instanceof ProbeHostShortCircuited
        ? error.reason
        : segment
          ? 'segment_failed'
          : error instanceof ProbeFailure
            ? error.reason
            : error instanceof ResponseSizeLimitError
              ? 'invalid_playlist'
              : connectionFailureReason(error);
    return {
      status: 'failed',
      checkedAt: Date.now(),
      ...(latencyMs === undefined ? {} : { latencyMs }),
      reason,
    };
  }
}

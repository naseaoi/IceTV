import type { LoadPolicy } from 'hls.js';

import { normalizeRuntimeParam } from '@/lib/runtime-params';

export const BROWSER_ROUTE_FAILURE_THRESHOLD = 3;
export const SERVER_ROUTE_FAILURE_THRESHOLD = 2;
export const AUTO_ROUTE_FAILURE_WINDOW_MS = 20_000;

// 运行参数只控制首字节超时；整段下载上限要容纳慢网下的大分片，不能随它缩短
export const VOD_FRAGMENT_MAX_LOAD_TIME_MS = 120_000;
export const VOD_FRAGMENT_TIMEOUT_MAX_RETRY = 2;
export const VOD_FRAGMENT_ERROR_MAX_RETRY = 3;
export const VOD_FRAGMENT_RETRY_DELAY_MS = 1_000;
export const VOD_FRAGMENT_MAX_RETRY_DELAY_MS = 4_000;

export function resolveVodFragmentTimeoutMs(
  configuredSeconds: unknown,
): number {
  return (
    normalizeRuntimeParam('VodFragmentTimeoutSeconds', configuredSeconds) * 1000
  );
}

// hls.js 会用传入的 fragLoadPolicy 完全取代默认值，四个字段必须给全
export function buildVodFragLoadPolicy(timeToFirstByteMs: number): LoadPolicy {
  return {
    default: {
      maxTimeToFirstByteMs: timeToFirstByteMs,
      maxLoadTimeMs: Math.max(VOD_FRAGMENT_MAX_LOAD_TIME_MS, timeToFirstByteMs),
      timeoutRetry: {
        maxNumRetry: VOD_FRAGMENT_TIMEOUT_MAX_RETRY,
        retryDelayMs: VOD_FRAGMENT_RETRY_DELAY_MS,
        maxRetryDelayMs: VOD_FRAGMENT_MAX_RETRY_DELAY_MS,
        backoff: 'exponential',
      },
      errorRetry: {
        maxNumRetry: VOD_FRAGMENT_ERROR_MAX_RETRY,
        retryDelayMs: VOD_FRAGMENT_RETRY_DELAY_MS,
        maxRetryDelayMs: VOD_FRAGMENT_MAX_RETRY_DELAY_MS,
        backoff: 'exponential',
      },
    },
  };
}

// 相邻两次分片失败最多相隔一次超时加一次退避；窗口小于这个间隔会让计数永远凑不满阈值
export function resolveAutoRouteFailureWindowMs(
  fragmentTimeoutMs: number,
): number {
  return Math.max(
    AUTO_ROUTE_FAILURE_WINDOW_MS,
    2 * fragmentTimeoutMs + VOD_FRAGMENT_MAX_RETRY_DELAY_MS,
  );
}

export class ConsecutiveRouteFailureTracker {
  private count = 0;
  private lastFailureAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly windowMs: number = AUTO_ROUTE_FAILURE_WINDOW_MS,
  ) {}

  record(now: number = Date.now()): boolean {
    if (this.lastFailureAt === 0 || now - this.lastFailureAt > this.windowMs) {
      this.count = 0;
    }
    this.count += 1;
    this.lastFailureAt = now;
    return this.count >= this.threshold;
  }

  reset(): void {
    this.count = 0;
    this.lastFailureAt = 0;
  }
}

import {
  AUTO_ROUTE_FAILURE_WINDOW_MS,
  AUTO_ROUTE_PROXY_PROBE_TIMEOUT_MS,
  buildVodFragLoadPolicy,
  ConsecutiveRouteFailureTracker,
  resolveAutoRouteFailureWindowMs,
  resolveAutoRouteProxyProbeTimeoutMs,
  resolveVodFragmentTimeoutMs,
  VOD_FRAGMENT_MAX_LOAD_TIME_MS,
  VOD_FRAGMENT_MAX_RETRY_DELAY_MS,
} from '@/features/play/lib/vodAutoRoutePolicy';

describe('VOD automatic route policy', () => {
  it('reaches the route threshold only after consecutive failures', () => {
    const tracker = new ConsecutiveRouteFailureTracker(3);

    expect(tracker.record(1_000)).toBe(false);
    expect(tracker.record(2_000)).toBe(false);
    expect(tracker.record(3_000)).toBe(true);
  });

  it('resets after a successful request', () => {
    const tracker = new ConsecutiveRouteFailureTracker(2);

    expect(tracker.record(1_000)).toBe(false);
    tracker.reset();
    expect(tracker.record(2_000)).toBe(false);
  });

  it('starts a new sequence after the failure window', () => {
    const tracker = new ConsecutiveRouteFailureTracker(2);

    expect(tracker.record(1_000)).toBe(false);
    expect(tracker.record(1_000 + AUTO_ROUTE_FAILURE_WINDOW_MS + 1)).toBe(
      false,
    );
  });

  it('honours a custom failure window', () => {
    const tracker = new ConsecutiveRouteFailureTracker(2, 30_000);

    expect(tracker.record(1_000)).toBe(false);
    expect(tracker.record(26_000)).toBe(true);
  });
});

describe('VOD fragment load policy', () => {
  it('normalizes the configured fragment timeout into milliseconds', () => {
    expect(resolveVodFragmentTimeoutMs(12)).toBe(12_000);
    expect(resolveVodFragmentTimeoutMs(undefined)).toBe(10_000);
    expect(resolveVodFragmentTimeoutMs(1)).toBe(3_000);
    expect(resolveVodFragmentTimeoutMs(600)).toBe(60_000);
  });

  it('builds a complete policy with the configured time to first byte', () => {
    const policy = buildVodFragLoadPolicy(10_000);

    expect(policy.default.maxTimeToFirstByteMs).toBe(10_000);
    expect(policy.default.maxLoadTimeMs).toBe(VOD_FRAGMENT_MAX_LOAD_TIME_MS);
    expect(policy.default.timeoutRetry).toEqual({
      maxNumRetry: 2,
      retryDelayMs: 1_000,
      maxRetryDelayMs: VOD_FRAGMENT_MAX_RETRY_DELAY_MS,
      backoff: 'exponential',
    });
    expect(policy.default.errorRetry).toEqual({
      maxNumRetry: 3,
      retryDelayMs: 1_000,
      maxRetryDelayMs: VOD_FRAGMENT_MAX_RETRY_DELAY_MS,
      backoff: 'exponential',
    });
  });

  it('keeps the whole-fragment limit above the first byte timeout', () => {
    const policy = buildVodFragLoadPolicy(VOD_FRAGMENT_MAX_LOAD_TIME_MS + 1);

    expect(policy.default.maxLoadTimeMs).toBe(
      VOD_FRAGMENT_MAX_LOAD_TIME_MS + 1,
    );
  });

  it('derives the failure window from the fragment timeout', () => {
    expect(resolveAutoRouteFailureWindowMs(5_000)).toBe(
      AUTO_ROUTE_FAILURE_WINDOW_MS,
    );
    expect(resolveAutoRouteFailureWindowMs(10_000)).toBe(
      2 * 10_000 + VOD_FRAGMENT_MAX_RETRY_DELAY_MS,
    );
    expect(resolveAutoRouteFailureWindowMs(30_000)).toBe(64_000);
  });

  it('derives the proxy probe timeout from the fragment timeout', () => {
    expect(resolveAutoRouteProxyProbeTimeoutMs(3_000)).toBe(
      AUTO_ROUTE_PROXY_PROBE_TIMEOUT_MS,
    );
    expect(resolveAutoRouteProxyProbeTimeoutMs(30_000)).toBe(30_000);
  });
});

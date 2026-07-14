import {
  AUTO_ROUTE_FAILURE_WINDOW_MS,
  ConsecutiveRouteFailureTracker,
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
});

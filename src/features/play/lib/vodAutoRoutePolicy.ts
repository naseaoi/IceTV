export const BROWSER_ROUTE_FAILURE_THRESHOLD = 3;
export const SERVER_ROUTE_FAILURE_THRESHOLD = 2;
export const AUTO_ROUTE_FAILURE_WINDOW_MS = 20_000;
export const AUTO_ROUTE_PROXY_COOLDOWN_MS = 60_000;
export const AUTO_ROUTE_PROXY_PROBE_TIMEOUT_MS = 8_000;

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

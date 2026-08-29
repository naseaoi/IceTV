import 'server-only';

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitVerdict = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const MAX_BUCKETS = 5000;

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitVerdict {
    this.prune(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    if (bucket.count <= this.maxRequests) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  private prune(now: number): void {
    if (this.buckets.size <= MAX_BUCKETS) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }

    const overflow = this.buckets.size - MAX_BUCKETS;
    if (overflow <= 0) {
      return;
    }

    for (const key of Array.from(this.buckets.keys()).slice(0, overflow)) {
      this.buckets.delete(key);
    }
  }
}

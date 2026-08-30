/** @jest-environment node */

import { FixedWindowRateLimiter } from '@/lib/fixed-window-rate-limit';

describe('FixedWindowRateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);

    expect(limiter.check('ip', 1000).allowed).toBe(true);
    expect(limiter.check('ip', 1100).allowed).toBe(true);
    expect(limiter.check('ip', 1200).allowed).toBe(true);
  });

  it('blocks the request that exceeds the limit and reports retry delay', () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000);

    limiter.check('ip', 1000);
    limiter.check('ip', 1000);
    const verdict = limiter.check('ip', 31_000);

    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(30);
  });

  it('reports at least one second of retry delay', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);

    limiter.check('ip', 0);
    const verdict = limiter.check('ip', 59_900);

    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(1);
  });

  it('starts a fresh window after the previous one expires', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);

    expect(limiter.check('ip', 0).allowed).toBe(true);
    expect(limiter.check('ip', 100).allowed).toBe(false);
    expect(limiter.check('ip', 60_000).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);

    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(false);
    expect(limiter.check('b', 0).allowed).toBe(true);
  });
});

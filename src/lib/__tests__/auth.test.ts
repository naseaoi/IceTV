import { getSessionExpiresAt } from '../auth.server';

describe('getSessionExpiresAt', () => {
  const originalTtl = process.env.AUTH_SESSION_TTL_HOURS;
  const now = Date.parse('2026-01-01T00:00:00.000Z');

  afterEach(() => {
    if (originalTtl === undefined) {
      delete process.env.AUTH_SESSION_TTL_HOURS;
    } else {
      process.env.AUTH_SESSION_TTL_HOURS = originalTtl;
    }
  });

  it('uses a 30 day default ttl', () => {
    delete process.env.AUTH_SESSION_TTL_HOURS;

    expect(getSessionExpiresAt(now)).toBe(now + 30 * 24 * 60 * 60 * 1000);
  });

  it('keeps explicit permanent sessions', () => {
    process.env.AUTH_SESSION_TTL_HOURS = '0';

    expect(getSessionExpiresAt(now)).toBe(
      Date.parse('2099-12-31T23:59:59.999Z'),
    );
  });
});

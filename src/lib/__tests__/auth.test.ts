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
    jest.restoreAllMocks();
  });

  it('uses a 30 day default ttl', () => {
    delete process.env.AUTH_SESSION_TTL_HOURS;

    expect(getSessionExpiresAt(now)).toBe(now + 30 * 24 * 60 * 60 * 1000);
  });

  it('uses the default ttl when configured ttl is not positive', () => {
    process.env.AUTH_SESSION_TTL_HOURS = '0';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getSessionExpiresAt(now)).toBe(now + 30 * 24 * 60 * 60 * 1000);
    expect(warnSpy).toHaveBeenCalledWith(
      'AUTH_SESSION_TTL_HOURS 无效，使用默认会话时长',
    );
  });
});

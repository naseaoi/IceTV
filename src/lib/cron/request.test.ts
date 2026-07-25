import { isCronAuthorized, parseCronTask } from './request';

describe('cron request helpers', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  afterAll(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it.each([
    ['http://localhost/api/cron', 'all'],
    ['http://localhost/api/cron?task=all', 'all'],
    ['http://localhost/api/cron?task=config', 'config'],
    ['http://localhost/api/cron?task=live', 'live'],
    ['http://localhost/api/cron?task=metadata', 'metadata'],
  ])('解析任务 %s', (url, expected) => {
    expect(parseCronTask(url)).toBe(expected);
  });

  it('拒绝未知任务', () => {
    expect(parseCronTask('http://localhost/api/cron?task=unknown')).toBeNull();
  });

  it('只接受匹配的 Bearer 密钥', () => {
    process.env.CRON_SECRET = 'test-secret';

    expect(
      isCronAuthorized({
        get: () => 'Bearer test-secret',
      }),
    ).toBe(true);
    expect(
      isCronAuthorized({
        get: () => 'Bearer wrong-secret',
      }),
    ).toBe(false);
    expect(
      isCronAuthorized({
        get: () => null,
      }),
    ).toBe(false);
  });
});

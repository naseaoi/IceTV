import {
  fetchDanmakuByEpisodeId,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/provider.server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: jest.fn(),
  UrlValidationError: class UrlValidationError extends Error {},
}));

describe('danmaku provider missing episodes', () => {
  const originalFetch = global.fetch;
  const originalBase = process.env.DANMAKU_API_BASE_URL;
  const originalAllowPrivate = process.env.DANMAKU_API_ALLOW_PRIVATE;

  beforeEach(() => {
    process.env.DANMAKU_API_BASE_URL = 'http://127.0.0.1:9321';
    process.env.DANMAKU_API_ALLOW_PRIVATE = 'true';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.DANMAKU_API_BASE_URL;
    else process.env.DANMAKU_API_BASE_URL = originalBase;
    if (originalAllowPrivate === undefined)
      delete process.env.DANMAKU_API_ALLOW_PRIVATE;
    else process.env.DANMAKU_API_ALLOW_PRIVATE = originalAllowPrivate;
  });

  it('identifies expired comment episode IDs', async () => {
    await expect(fetchDanmakuByEpisodeId(123, 100)).rejects.toMatchObject({
      kind: 'episode-not-found',
    });
  });

  it('does not treat a missing search endpoint as an expired episode', async () => {
    await expect(searchDanmakuCandidates('test')).rejects.toMatchObject({
      kind: 'upstream-rejected',
    });
  });

  it('keeps server failures distinct from expired IDs', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 502 });
    await expect(fetchDanmakuByEpisodeId(123, 100)).rejects.toMatchObject({
      kind: 'upstream-rejected',
    });
  });
});

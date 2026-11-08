import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import {
  fetchDanmakuByEpisodeId,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/provider.server';
import { DanmakuProviderError } from '@/features/play/lib/danmaku/types';
import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';
import { fetchWithUrlGuard } from '@/lib/url-guard';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: jest.fn(),
  UrlValidationError: class UrlValidationError extends Error {},
}));

installStreamPolyfills();

describe('danmaku provider missing episodes', () => {
  const originalFetch = global.fetch;
  const originalBase = process.env.DANMAKU_API_BASE_URL;
  const originalAllowPrivate = process.env.DANMAKU_API_ALLOW_PRIVATE;
  let testNumber = 0;

  beforeEach(() => {
    process.env.DANMAKU_API_BASE_URL = `http://127.0.0.1:9321/${++testNumber}`;
    process.env.DANMAKU_API_ALLOW_PRIVATE = 'true';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('honors upstream rate limits without repeatedly calling the service', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const cancel = jest.fn().mockResolvedValue(undefined);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '30' },
        body: { cancel },
      })
      .mockImplementation(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                // 显式关闭正文，避免假时钟暂停 Response 的关闭微任务。
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify({ comments: [] })),
                );
                controller.close();
              },
            }),
          ),
      );
    await expect(fetchDanmakuByEpisodeId(123, 100)).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterSeconds: 30,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10_000);
    await expect(fetchDanmakuByEpisodeId(456, 100)).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterSeconds: 20,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(20_000);
    await expect(fetchDanmakuByEpisodeId(456, 100)).resolves.toEqual({
      items: [],
      total: 0,
      truncated: false,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed success payloads rather than caching them as empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, errorMessage: 'private details' }),
      ),
    );
    await expect(fetchDanmakuByEpisodeId(123, 100)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('rejects streamed bodies over 12 MiB without Content-Length', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    const cancel = jest.fn();
    let chunksSent = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (chunksSent < 12) {
              controller.enqueue(chunk);
            } else if (chunksSent === 12) {
              controller.enqueue(new TextEncoder().encode('{"comments":[]}'));
            } else {
              controller.close();
            }
            chunksSent++;
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
    expect(response.headers.has('content-length')).toBe(false);
    (global.fetch as jest.Mock).mockResolvedValue(response);

    const pending = fetchDanmakuByEpisodeId(123, 100);
    await expect(pending).rejects.toBeInstanceOf(DanmakuProviderError);
    await expect(pending).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(chunksSent).toBe(13);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('passes custom and default request deadlines to guarded upstream requests', async () => {
    process.env.DANMAKU_API_ALLOW_PRIVATE = 'false';
    const guardedFetch = fetchWithUrlGuard as jest.Mock;
    guardedFetch
      .mockReset()
      .mockImplementation(
        async () => new Response(JSON.stringify({ animes: [], comments: [] })),
      );

    await searchDanmakuCandidates('test');
    expect(guardedFetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        timeoutMs: DEFAULT_RUNTIME_PARAMS.DanmakuRequestTimeoutSeconds * 1000,
      }),
    );
    await fetchDanmakuByEpisodeId(123, 100, 2500);
    expect(guardedFetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ timeoutMs: 2500 }),
    );
  });

  it('aborts a private upstream request at the configured deadline', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    (global.fetch as jest.Mock).mockImplementation(
      (_url, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    );

    const pending = fetchDanmakuByEpisodeId(123, 100, 2500);
    const rejected = expect(pending).rejects.toMatchObject({
      kind: 'upstream-unavailable',
    });
    await Promise.resolve();
    jest.advanceTimersByTime(2499);
    expect(signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal?.aborted).toBe(true);
    await rejected;
  });
});

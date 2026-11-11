import {
  peekResolvedLazyEpisodeUrl,
  resolveLazyEpisodeUrl,
} from '@/features/play/lib/lazyEpisode';

const originalFetch = global.fetch;

function createJsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe('resolveLazyEpisodeUrl', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('非懒地址直接返回，不发请求', async () => {
    await expect(
      resolveLazyEpisodeUrl('giri', 'https://cdn.example/video.m3u8'),
    ).resolves.toBe('https://cdn.example/video.m3u8');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('解析成功并写入缓存', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      createJsonResponse({ url: 'https://cdn.example/ep1.m3u8' }),
    );
    const lazyUrl = 'icetv-lazy://giri/playGV1-1-1/';

    await expect(resolveLazyEpisodeUrl('giri', lazyUrl)).resolves.toBe(
      'https://cdn.example/ep1.m3u8',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/episode-url?source=giri&url=${encodeURIComponent(lazyUrl)}`,
      { signal: expect.any(AbortSignal) },
    );

    expect(peekResolvedLazyEpisodeUrl('giri', lazyUrl)).toBe(
      'https://cdn.example/ep1.m3u8',
    );
    await resolveLazyEpisodeUrl('giri', lazyUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('并发解析同一地址只发一次请求', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      createJsonResponse({ url: 'https://cdn.example/ep2.m3u8' }),
    );
    const lazyUrl = 'icetv-lazy://giri/playGV2-1-1/';

    const [first, second] = await Promise.all([
      resolveLazyEpisodeUrl('giri', lazyUrl),
      resolveLazyEpisodeUrl('giri', lazyUrl),
    ]);

    expect(first).toBe('https://cdn.example/ep2.m3u8');
    expect(second).toBe('https://cdn.example/ep2.m3u8');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('解析失败抛出服务端错误信息且不缓存', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({ error: '播放地址解析失败' }, false),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ url: 'https://cdn.example/ep3.m3u8' }),
      );
    const lazyUrl = 'icetv-lazy://giri/playGV3-1-1/';

    await expect(resolveLazyEpisodeUrl('giri', lazyUrl)).rejects.toThrow(
      '播放地址解析失败',
    );
    expect(peekResolvedLazyEpisodeUrl('giri', lazyUrl)).toBeNull();

    await expect(resolveLazyEpisodeUrl('giri', lazyUrl)).resolves.toBe(
      'https://cdn.example/ep3.m3u8',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

test('最后一个消费者取消才中止懒解析，取消预热保留正式播放', async () => {
  const previous = global.fetch;
  let signal!: AbortSignal;
  let finish!: (response: Response) => void;
  global.fetch = jest.fn((_url, init) => {
    signal = init!.signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      finish = resolve;
      signal.addEventListener('abort', () =>
        reject(new DOMException('cancel', 'AbortError')),
      );
    });
  });
  try {
    const warmup = new AbortController();
    const playback = new AbortController();
    const url = 'icetv-lazy://giri/shared-cancel/';
    const first = resolveLazyEpisodeUrl('giri', url, { signal: warmup.signal });
    const second = resolveLazyEpisodeUrl('giri', url, {
      signal: playback.signal,
    });
    const cancelled = expect(first).rejects.toMatchObject({
      name: 'AbortError',
    });
    warmup.abort();
    await cancelled;
    expect(signal.aborted).toBe(false);
    finish(createJsonResponse({ url: 'https://cdn.test/shared.m3u8' }));
    await expect(second).resolves.toBe('https://cdn.test/shared.m3u8');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const last = new AbortController();
    const task = resolveLazyEpisodeUrl(
      'giri',
      'icetv-lazy://giri/last-cancel/',
      { signal: last.signal },
    );
    const rejection = expect(task).rejects.toMatchObject({
      name: 'AbortError',
    });
    last.abort();
    await rejection;
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
  } finally {
    global.fetch = previous;
  }
});

test('probe 与 playback 在途解析保持独立', async () => {
  const previous = global.fetch;
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      createJsonResponse({ url: 'https://cdn.test/separate.m3u8' }),
    );
  try {
    const url = 'icetv-lazy://giri/separate/';
    await Promise.all([
      resolveLazyEpisodeUrl('giri', url, { probe: true }),
      resolveLazyEpisodeUrl('giri', url),
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  } finally {
    global.fetch = previous;
  }
});

test('同轮取消预热后正式播放接管在途请求', async () => {
  const previous = global.fetch;
  let finish!: (value: Response) => void;
  let signal!: AbortSignal;
  global.fetch = jest.fn((_url, init) => {
    signal = init!.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  try {
    const controller = new AbortController();
    const url = 'icetv-lazy://giri/handoff/';
    const warmup = resolveLazyEpisodeUrl('giri', url, {
      signal: controller.signal,
    });
    const rejected = expect(warmup).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    const playback = resolveLazyEpisodeUrl('giri', url);
    await rejected;
    expect(signal.aborted).toBe(false);
    finish(createJsonResponse({ url: 'https://cdn.test/handoff.m3u8' }));
    await expect(playback).resolves.toBe('https://cdn.test/handoff.m3u8');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally {
    global.fetch = previous;
  }
});

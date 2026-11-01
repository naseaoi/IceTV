import {
  type FragmentFetcher,
  type FragmentMemoryEntry,
  createFragmentEntryFromResponse,
  createFragmentMemoryCache,
  parseContentRange,
  withFragmentMemoryCache,
} from '@/features/play/lib/fragmentMemoryCache';

const SEGMENT_URL = 'https://cdn.example.com/video/seg-0.ts';
const PROXY_SEGMENT_URL =
  'https://app.example.com/api/proxy/segment?url=https%3A%2F%2Fcdn.example.com%2Fseg-0.ts&icetv-source=demo';
const LOADER_CONFIG = {
  timeout: 30_000,
  loadPolicy: { maxTimeToFirstByteMs: 30_000, maxLoadTimeMs: 30_000 },
};

type Stats = {
  aborted: boolean;
  loaded: number;
  total: number;
  bwEstimate: number;
  loading: { start: number; first: number; end: number };
};

function createBytes(length: number, seed = 1): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    data[index] = (index * 7 + seed) % 251;
  }
  return data;
}

function createStats() {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

function createBaseLoaderHarness() {
  const loads: Array<{
    callbacks: unknown;
    config: unknown;
    context: unknown;
    startAtLoad: number;
  }> = [];
  const instances: Array<{ abortCount: number; destroyCount: number }> = [];
  class BaseLoader {
    stats = createStats();
    context: unknown = null;
    abortCount = 0;
    destroyCount = 0;

    constructor(_config: unknown) {
      instances.push(this);
    }

    load(context: unknown, config: unknown, callbacks: unknown) {
      this.context = context;
      loads.push({
        callbacks,
        config,
        context,
        startAtLoad: this.stats.loading.start,
      });
    }

    abort() {
      this.abortCount += 1;
    }

    destroy() {
      this.destroyCount += 1;
    }
  }
  return { BaseLoader, instances, loads };
}

function createCallbacks() {
  return {
    onAbort: jest.fn(),
    onError: jest.fn(),
    onProgress: jest.fn(),
    onSuccess: jest.fn(),
    onTimeout: jest.fn(),
  };
}

function fragmentContext(url = SEGMENT_URL, extra: object = {}) {
  return {
    frag: {},
    part: null,
    url,
    headers: {},
    rangeStart: 0,
    rangeEnd: 0,
    responseType: 'arraybuffer',
    ...extra,
  };
}

function entryOf(
  data: Uint8Array,
  overrides: Partial<FragmentMemoryEntry> = {},
): FragmentMemoryEntry {
  return {
    data,
    complete: true,
    totalBytes: data.byteLength,
    ttfbMs: 100,
    transferMs: 400,
    ...overrides,
  };
}

function createRangeResponse(
  status: number,
  body: Uint8Array,
  contentRange: string | null = null,
) {
  return {
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-range' ? contentRange : null,
    },
    arrayBuffer: async () => body.slice().buffer,
  };
}

function createPendingFetcher() {
  const signals: AbortSignal[] = [];
  const fetcher: FragmentFetcher = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  return { fetcher, signals };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function receivedBytes(callbacks: ReturnType<typeof createCallbacks>) {
  const response = callbacks.onSuccess.mock.calls[0][0] as {
    data: ArrayBuffer;
  };
  return Array.from(new Uint8Array(response.data));
}

describe('fragment memory cache', () => {
  it('consumes entries and ignores volatile signing params in the key', () => {
    const cache = createFragmentMemoryCache();
    const data = createBytes(16);

    expect(
      cache.put(
        `${PROXY_SEGMENT_URL}&icetv-expires=1&icetv-signature=first`,
        entryOf(data),
      ),
    ).toBe(true);

    const hit = cache.take(
      `${PROXY_SEGMENT_URL}&icetv-switch=episode&icetv-expires=2&icetv-signature=second`,
    );
    expect(hit?.data).toBe(data);
    expect(cache.take(PROXY_SEGMENT_URL)).toBeNull();
  });

  it('expires entries after the ttl', () => {
    let now = 1_000;
    const cache = createFragmentMemoryCache({ ttlMs: 500, now: () => now });
    cache.put(SEGMENT_URL, entryOf(createBytes(8)));

    now += 499;
    expect(cache.has(SEGMENT_URL)).toBe(true);
    now += 1;
    expect(cache.has(SEGMENT_URL)).toBe(false);
    expect(cache.getUsage()).toEqual({ entries: 0, bytes: 0 });
  });

  it('evicts the oldest entries beyond the entry and byte limits', () => {
    const cache = createFragmentMemoryCache({ maxEntries: 2, maxBytes: 100 });
    cache.put(`${SEGMENT_URL}?a`, entryOf(createBytes(40)));
    cache.put(`${SEGMENT_URL}?b`, entryOf(createBytes(40)));
    cache.put(`${SEGMENT_URL}?c`, entryOf(createBytes(40)));

    expect(cache.has(`${SEGMENT_URL}?a`)).toBe(false);
    expect(cache.getUsage()).toEqual({ entries: 2, bytes: 80 });

    cache.put(`${SEGMENT_URL}?d`, entryOf(createBytes(90)));
    expect(cache.getUsage()).toEqual({ entries: 1, bytes: 90 });
    expect(cache.put(`${SEGMENT_URL}?e`, entryOf(createBytes(101)))).toBe(
      false,
    );
  });

  it('rejects inconsistent entries and never downgrades a complete entry', () => {
    const cache = createFragmentMemoryCache();
    const data = createBytes(32);

    expect(cache.put('/relative/seg.ts', entryOf(data))).toBe(false);
    expect(cache.put(SEGMENT_URL, entryOf(new Uint8Array(0)))).toBe(false);
    expect(cache.put(SEGMENT_URL, entryOf(data, { totalBytes: 64 }))).toBe(
      false,
    );

    cache.put(SEGMENT_URL, entryOf(data));
    expect(
      cache.put(
        SEGMENT_URL,
        entryOf(createBytes(8), { complete: false, totalBytes: 32 }),
      ),
    ).toBe(false);
    expect(cache.take(SEGMENT_URL)?.complete).toBe(true);
  });

  it('parses content-range headers', () => {
    expect(parseContentRange('bytes 100-199/200')).toEqual({
      start: 100,
      end: 199,
      total: 200,
    });
    expect(parseContentRange('bytes 0-9/*')).toEqual({
      start: 0,
      end: 9,
      total: null,
    });
    expect(parseContentRange('bytes 10-5/20')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});

describe('createFragmentEntryFromResponse', () => {
  const timing = { ttfbMs: 50, transferMs: 200 };
  const response = (status: number, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });

  it('treats a fully read 200 response as a complete fragment', () => {
    expect(
      createFragmentEntryFromResponse(response(200), createBytes(10), {
        ...timing,
        streamEnded: true,
        requestedBytes: null,
      }),
    ).toMatchObject({ complete: true, totalBytes: 10 });
  });

  it('keeps an interrupted read as a prefix of the known total', () => {
    expect(
      createFragmentEntryFromResponse(
        response(200, { 'content-length': '40' }),
        createBytes(10),
        { ...timing, streamEnded: false, requestedBytes: 1_024 },
      ),
    ).toMatchObject({ complete: false, totalBytes: 40 });
    expect(
      createFragmentEntryFromResponse(
        response(206, { 'content-range': 'bytes 0-1023/4096' }),
        createBytes(10),
        { ...timing, streamEnded: false, requestedBytes: 1_024 },
      ),
    ).toMatchObject({ complete: false, totalBytes: 4_096 });
  });

  it('infers completeness from a short 206 body when content-range is hidden', () => {
    expect(
      createFragmentEntryFromResponse(response(206), createBytes(10), {
        ...timing,
        streamEnded: true,
        requestedBytes: 1_024,
      }),
    ).toMatchObject({ complete: true, totalBytes: 10 });
    expect(
      createFragmentEntryFromResponse(response(206), createBytes(1_024), {
        ...timing,
        streamEnded: true,
        requestedBytes: 1_024,
      }),
    ).toMatchObject({ complete: false, totalBytes: null });
  });

  it('rejects encoded, offset or inconsistent responses', () => {
    const options = { ...timing, streamEnded: true, requestedBytes: 1_024 };
    expect(
      createFragmentEntryFromResponse(
        response(200, { 'content-encoding': 'gzip' }),
        createBytes(10),
        options,
      ),
    ).toBeNull();
    expect(
      createFragmentEntryFromResponse(
        response(206, { 'content-range': 'bytes 5-14/100' }),
        createBytes(10),
        options,
      ),
    ).toBeNull();
    expect(
      createFragmentEntryFromResponse(
        response(200, { 'content-length': '12' }),
        createBytes(10),
        options,
      ),
    ).toBeNull();
    expect(
      createFragmentEntryFromResponse(response(404), createBytes(10), options),
    ).toBeNull();
  });
});

describe('withFragmentMemoryCache', () => {
  it('delegates misses, non-fragment and bitrate test requests', () => {
    const cache = createFragmentMemoryCache();
    cache.put(SEGMENT_URL, entryOf(createBytes(8)));
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache });

    new Loader({}).load(
      fragmentContext(`${SEGMENT_URL}?other`),
      LOADER_CONFIG,
      createCallbacks(),
    );
    new Loader({}).load(
      { url: SEGMENT_URL, headers: {} },
      LOADER_CONFIG,
      createCallbacks(),
    );
    new Loader({}).load(
      fragmentContext(SEGMENT_URL, { frag: { bitrateTest: true } }),
      LOADER_CONFIG,
      createCallbacks(),
    );
    new Loader({}).load(
      fragmentContext(SEGMENT_URL, { rangeStart: 0, rangeEnd: 4 }),
      LOADER_CONFIG,
      createCallbacks(),
    );

    expect(loads).toHaveLength(4);
    expect(cache.has(SEGMENT_URL)).toBe(true);
  });

  it('uses config.loader as the base loader by default', () => {
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(undefined, {
      cache: createFragmentMemoryCache(),
    });
    const loader = new Loader({ loader: BaseLoader }) as unknown as {
      stats: Stats;
      load: (...args: unknown[]) => void;
    };

    loader.load(fragmentContext(), LOADER_CONFIG, createCallbacks());

    expect(loads).toHaveLength(1);
    expect(loader.stats.loading.start).toBe(0);
  });

  it('serves complete entries asynchronously with realistic stats', async () => {
    const cache = createFragmentMemoryCache();
    const data = createBytes(4_000);
    cache.put(SEGMENT_URL, entryOf(data, { ttfbMs: 120, transferMs: 380 }));
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache });
    const loader = new Loader({}) as unknown as { stats: Stats };
    const callbacks = createCallbacks();

    (loader as unknown as { load: (...args: unknown[]) => void }).load(
      fragmentContext(),
      LOADER_CONFIG,
      callbacks,
    );
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    await flush();

    expect(loads).toHaveLength(0);
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1);
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    expect(receivedBytes(callbacks)).toEqual(Array.from(data));
    const { stats } = loader;
    expect(stats.loaded).toBe(4_000);
    expect(stats.total).toBe(4_000);
    expect(stats.loading.first - stats.loading.start).toBeCloseTo(120, 5);
    expect(stats.loading.end - stats.loading.first).toBeCloseTo(380, 5);
    expect(stats.bwEstimate).toBeCloseTo((4_000 * 8_000) / 380, 5);
    expect(cache.has(SEGMENT_URL)).toBe(false);
  });

  it('completes prefix entries with a range request', async () => {
    const cache = createFragmentMemoryCache();
    const full = createBytes(1_000);
    cache.put(
      SEGMENT_URL,
      entryOf(full.slice(0, 600), {
        complete: false,
        totalBytes: 1_000,
        transferMs: 250,
      }),
    );
    const fetcher = jest.fn<
      ReturnType<FragmentFetcher>,
      Parameters<FragmentFetcher>
    >(async () =>
      createRangeResponse(206, full.slice(600), 'bytes 600-999/1000'),
    );
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache, fetcher });
    const loader = new Loader({}) as unknown as {
      stats: Stats;
      load: (...args: unknown[]) => void;
    };
    const callbacks = createCallbacks();

    loader.load(
      fragmentContext(SEGMENT_URL, { headers: { 'X-Test': '1' } }),
      LOADER_CONFIG,
      callbacks,
    );
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].headers).toEqual({
      'X-Test': '1',
      Range: 'bytes=600-',
    });
    expect(loads).toHaveLength(0);
    expect(receivedBytes(callbacks)).toEqual(Array.from(full));
    const { stats } = loader;
    expect(stats.loaded).toBe(1_000);
    expect(stats.total).toBe(1_000);
    expect(stats.loading.first).toBeGreaterThanOrEqual(stats.loading.start);
    expect(stats.loading.end - stats.loading.first).toBeGreaterThanOrEqual(250);
  });

  it('uses the full body when the server ignores the range', async () => {
    const cache = createFragmentMemoryCache();
    const full = createBytes(900, 3);
    cache.put(
      SEGMENT_URL,
      entryOf(full.slice(0, 300), { complete: false, totalBytes: null }),
    );
    const fetcher: FragmentFetcher = async () => createRangeResponse(200, full);
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache, fetcher });
    const callbacks = createCallbacks();

    new Loader({}).load(fragmentContext(), LOADER_CONFIG, callbacks);
    await flush();

    expect(loads).toHaveLength(0);
    expect(receivedBytes(callbacks)).toEqual(Array.from(full));
  });

  it.each([
    [
      'network failure',
      (async () => {
        throw new Error('offline');
      }) as FragmentFetcher,
    ],
    [
      'unexpected status',
      (async () =>
        createRangeResponse(416, new Uint8Array(0))) as FragmentFetcher,
    ],
    [
      'mismatched content-range',
      (async () =>
        createRangeResponse(
          206,
          createBytes(400),
          'bytes 0-399/1000',
        )) as FragmentFetcher,
    ],
    [
      'unexpected total length',
      (async () =>
        createRangeResponse(206, createBytes(100))) as FragmentFetcher,
    ],
  ])('falls back to the base loader on %s', async (_label, fetcher) => {
    const cache = createFragmentMemoryCache();
    cache.put(
      SEGMENT_URL,
      entryOf(createBytes(600), { complete: false, totalBytes: 1_000 }),
    );
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache, fetcher });
    const callbacks = createCallbacks();
    const context = fragmentContext();

    new Loader({}).load(context, LOADER_CONFIG, callbacks);
    await flush();

    expect(loads).toHaveLength(1);
    expect(loads[0].context).toBe(context);
    expect(loads[0].callbacks).toBe(callbacks);
    expect(loads[0].startAtLoad).toBe(0);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(cache.has(SEGMENT_URL)).toBe(false);
  });

  it('aborts pending memory delivery and restores the entry', async () => {
    const cache = createFragmentMemoryCache();
    cache.put(SEGMENT_URL, entryOf(createBytes(64)));
    const { BaseLoader } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache });
    const loader = new Loader({}) as unknown as {
      abort: () => void;
      load: (...args: unknown[]) => void;
      stats: Stats;
    };
    const callbacks = createCallbacks();

    loader.load(fragmentContext(), LOADER_CONFIG, callbacks);
    loader.abort();
    await flush();

    expect(callbacks.onAbort).toHaveBeenCalledTimes(1);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(loader.stats.aborted).toBe(true);
    expect(cache.has(SEGMENT_URL)).toBe(true);
  });

  it('aborts an in-flight range request without falling back', async () => {
    const cache = createFragmentMemoryCache();
    cache.put(
      SEGMENT_URL,
      entryOf(createBytes(600), { complete: false, totalBytes: 1_000 }),
    );
    const { fetcher, signals } = createPendingFetcher();
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache, fetcher });
    const loader = new Loader({}) as unknown as {
      abort: () => void;
      load: (...args: unknown[]) => void;
    };
    const callbacks = createCallbacks();

    loader.load(fragmentContext(), LOADER_CONFIG, callbacks);
    loader.abort();
    await flush();

    expect(signals[0].aborted).toBe(true);
    expect(callbacks.onAbort).toHaveBeenCalledTimes(1);
    expect(loads).toHaveLength(0);
    expect(cache.has(SEGMENT_URL)).toBe(true);
  });

  it('reports a timeout when the range request stalls', async () => {
    const cache = createFragmentMemoryCache();
    cache.put(
      SEGMENT_URL,
      entryOf(createBytes(600), { complete: false, totalBytes: 1_000 }),
    );
    const { fetcher, signals } = createPendingFetcher();
    const { BaseLoader, loads } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, { cache, fetcher });
    const callbacks = createCallbacks();

    new Loader({}).load(
      fragmentContext(),
      { timeout: 20, loadPolicy: { maxTimeToFirstByteMs: 20 } },
      callbacks,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(callbacks.onTimeout).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(true);
    expect(loads).toHaveLength(0);
  });

  it('forwards abort and destroy to the delegated loader', () => {
    const { BaseLoader, instances } = createBaseLoaderHarness();
    const Loader = withFragmentMemoryCache(BaseLoader, {
      cache: createFragmentMemoryCache(),
    });
    const loader = new Loader({}) as unknown as {
      abort: () => void;
      context: unknown;
      destroy: () => void;
      load: (...args: unknown[]) => void;
    };
    const context = fragmentContext();

    loader.load(context, LOADER_CONFIG, createCallbacks());
    loader.abort();
    loader.destroy();

    expect(loader.context).toBe(context);
    expect(instances[0]).toMatchObject({ abortCount: 1, destroyCount: 1 });
  });
});

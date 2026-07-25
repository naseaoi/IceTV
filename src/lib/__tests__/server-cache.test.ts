import { createSwrCache } from '@/lib/server-cache';

describe('server cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('合并同 key 回源请求并记录 fresh/stale 命中', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const cache = createSwrCache<string>({
      name: 'test',
      freshMs: 100,
      staleMs: 100,
      estimateWeight: (value) => value.length,
    });
    const loader = jest.fn(async () => 'value');

    const [first, second] = await Promise.all([
      cache.getOrLoad('key', loader),
      cache.getOrLoad('key', loader),
    ]);
    expect([first, second]).toEqual(['value', 'value']);
    expect(loader).toHaveBeenCalledTimes(1);

    await expect(cache.getOrLoad('key', loader)).resolves.toBe('value');
    jest.advanceTimersByTime(101);
    await expect(cache.getOrLoad('key', loader)).resolves.toBe('value');

    const stats = cache.stats();
    expect(stats.misses).toBe(2);
    expect(stats.freshHits).toBe(1);
    expect(stats.staleHits).toBe(1);
    expect(stats.size).toBe(1);
    expect(stats.estimatedBytes).toBe(5);
  });

  it('按最近访问顺序执行 LRU 淘汰', async () => {
    const cache = createSwrCache<string>({
      name: 'test',
      maxSize: 2,
      freshMs: 1_000,
      estimateWeight: (value) => value.length,
    });

    cache.set('a', 'a');
    cache.set('b', 'b');
    await expect(cache.getOrLoad('a', async () => 'replacement')).resolves.toBe(
      'a',
    );
    cache.set('c', 'c');

    expect(cache.peek('a')?.value).toBe('a');
    expect(cache.peek('b')).toBeNull();
    expect(cache.peek('c')?.value).toBe('c');
    expect(cache.stats().evictions).toBe(1);
  });

  it('按估算字节清理旧条目并跳过超预算值', () => {
    const cache = createSwrCache<string>({
      name: 'test',
      maxWeightBytes: 5,
      freshMs: 1_000,
      estimateWeight: (value) => value.length,
    });

    cache.set('a', '1234');
    cache.set('b', '12');
    expect(cache.peek('a')).toBeNull();
    expect(cache.peek('b')?.value).toBe('12');

    cache.set('large', '123456');
    expect(cache.peek('large')).toBeNull();
    expect(cache.peek('b')?.value).toBe('12');
    expect(cache.stats().estimatedBytes).toBe(2);
    expect(cache.stats().oversizedSkips).toBe(1);
  });

  it('大量写入时不会超过条目和字节预算', () => {
    const cache = createSwrCache<string>({
      name: 'pressure',
      maxSize: 20,
      maxWeightBytes: 100,
      freshMs: 1_000,
      estimateWeight: (value) => value.length,
    });

    for (let i = 0; i < 1_000; i += 1) {
      cache.set(`key-${i}`, '1234567890');
    }

    const stats = cache.stats();
    expect(stats.size).toBeLessThanOrEqual(20);
    expect(stats.estimatedBytes).toBeLessThanOrEqual(100);
  });

  it('写入前清理硬过期条目', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const cache = createSwrCache<string>({
      name: 'test',
      maxWeightBytes: 5,
      freshMs: 5,
      staleMs: 5,
      estimateWeight: (value) => value.length,
    });

    cache.set('expired', '12345');
    jest.advanceTimersByTime(11);
    cache.set('next', '1');

    expect(cache.peek('expired')).toBeNull();
    expect(cache.peek('next')?.value).toBe('1');
    expect(cache.stats().expirations).toBe(1);
  });

  it('清空缓存后未完成的回源不会重新写入', async () => {
    let resolveLoader!: (value: string) => void;
    const loader = new Promise<string>((resolve) => {
      resolveLoader = resolve;
    });
    const cache = createSwrCache<string>({
      name: 'test',
      freshMs: 1_000,
    });

    const pending = cache.getOrLoad('key', () => loader);
    cache.clear();
    resolveLoader('value');
    await expect(pending).resolves.toBe('value');
    expect(cache.size()).toBe(0);
  });
});

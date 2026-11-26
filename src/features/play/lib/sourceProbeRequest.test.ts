import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import type { fetchSourceProbe as FetchSourceProbe } from '@/features/play/lib/sourceProbeRequest';

installWebPolyfills();

describe('probe request admission', () => {
  const originalFetch = global.fetch;
  let fetchSourceProbe: typeof FetchSourceProbe;

  beforeEach(() => {
    jest.resetModules();
    fetchSourceProbe =
      require('@/features/play/lib/sourceProbeRequest').fetchSourceProbe;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('tags local requests while preserving Range and cancellation', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 206 });
    const controller = new AbortController();
    await fetchSourceProbe('/api/proxy/segment?url=test', {
      signal: controller.signal,
      headers: { Range: 'bytes=0-1023' },
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/proxy/segment?url=test', {
      signal: controller.signal,
      headers: { Range: 'bytes=0-1023', 'X-IceTV-Probe': '1' },
    });
  });

  it('does not add CORS preflight headers to direct upstream requests', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 200 });
    await fetchSourceProbe('https://up.example/segment.ts', {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(global.fetch).toHaveBeenCalledWith('https://up.example/segment.ts', {
      headers: { Range: 'bytes=0-1023' },
    });
  });

  it.each([
    [403, 'host-forbidden'],
    [502, 'host-connection'],
  ] as const)(
    'remembers %s host failure without refresh and skips subsequent forceServer requests',
    async (status, reason) => {
      const target = `https://blocked-${status}.example/a.m3u8`;
      const url = `/api/proxy/m3u8?forceServer=true&icetv-source=blocked&url=${encodeURIComponent(target)}`;
      (global.fetch as jest.Mock).mockResolvedValue({
        status,
        headers: new Headers({
          'X-IceTV-Relay-Failure': reason,
          'Retry-After': '600',
        }),
      });
      expect((await fetchSourceProbe(url)).status).toBe(status);
      await expect(
        fetchSourceProbe(url.replace('a.m3u8', 'b.m3u8')),
      ).rejects.toMatchObject({ name: 'SourceProbeNetworkError' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      await fetchSourceProbe(target);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('cancels busy responses and shares Retry-After cooldown across probe requests', async () => {
    let now = 100_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cancel = jest.fn().mockResolvedValue(undefined);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        status: 503,
        headers: new Headers({ 'Retry-After': '3' }),
        body: { cancel },
      })
      .mockResolvedValueOnce({ status: 200 });
    await expect(
      fetchSourceProbe('/api/detail?source=first'),
    ).rejects.toMatchObject({
      name: 'SourceProbeDeferredError',
      retryAfterSeconds: 3,
    });
    await expect(
      fetchSourceProbe('/api/detail?source=second'),
    ).rejects.toMatchObject({ name: 'SourceProbeDeferredError' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    now += 3000;
    await expect(
      fetchSourceProbe('/api/detail?source=second'),
    ).resolves.toMatchObject({ status: 200 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

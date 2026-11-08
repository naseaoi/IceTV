/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

const mockFetch = jest.fn();
const sharedRecords = new Map<
  string,
  { value: string; freshUntil: number; staleUntil: number; leaseUntil: number }
>();

jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (url: string, init: RequestInit) => mockFetch(url, init),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getSharedCache: async (key: string) => sharedRecords.get(key) ?? null,
    acquireSharedCacheLease: async () => true,
    setSharedCache: async (
      key: string,
      _token: string,
      value: string,
      freshUntil: number,
      staleUntil: number,
    ) => {
      sharedRecords.set(key, { value, freshUntil, staleUntil, leaseUntil: 0 });
      return true;
    },
    releaseSharedCacheLease: async () => {},
  },
}));

installStreamPolyfills();
const capability =
  require('./source-route-capability.server') as typeof import('./source-route-capability.server');

const PLAYLIST = [
  '#EXTM3U',
  '#EXTINF:5,',
  'ad.ts',
  '#EXTINF:5,',
  'seg-1.ts',
  '#EXTINF:5,',
  'seg-2.ts',
  '#EXT-X-ENDLIST',
].join('\n');

function segmentResponse(headers: Record<string, string> = {}, status = 206) {
  return new Response('x', { status, headers });
}

async function flushProbe() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  mockFetch.mockReset();
  sharedRecords.clear();
  capability.resetSourceRouteCapabilityForTests();
});

it('picks a middle segment of media playlists and skips master playlists', () => {
  expect(
    capability.pickProbeSegmentUrl(
      PLAYLIST,
      'https://cdn.example/v/index.m3u8',
    ),
  ).toBe('https://cdn.example/v/seg-1.ts');
  expect(
    capability.pickProbeSegmentUrl(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhd.m3u8',
      'https://cdn.example/v/index.m3u8',
    ),
  ).toBeNull();
});

it('detects mixed content without requesting the upstream', async () => {
  await expect(
    capability.probeSourceDirectCapability({
      segmentUrl: 'http://cdn.example/a.ts',
      pageOrigin: 'https://tv.example',
      userAgent: 'ua',
    }),
  ).resolves.toMatchObject({ direct: 'blocked', reason: 'mixed-content' });
  expect(mockFetch).not.toHaveBeenCalled();
});

it('classifies CORS from a request carrying the page origin', async () => {
  mockFetch.mockResolvedValueOnce(
    segmentResponse({ 'Access-Control-Allow-Origin': 'https://tv.example' }),
  );
  await expect(
    capability.probeSourceDirectCapability({
      segmentUrl: 'https://cdn.example/a.ts',
      pageOrigin: 'https://tv.example',
      userAgent: 'ua',
    }),
  ).resolves.toMatchObject({ direct: 'ok' });
  expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
    Origin: 'https://tv.example',
  });

  mockFetch.mockResolvedValueOnce(segmentResponse());
  await expect(
    capability.probeSourceDirectCapability({
      segmentUrl: 'https://cdn.example/a.ts',
      pageOrigin: 'https://tv.example',
      userAgent: 'ua',
    }),
  ).resolves.toMatchObject({ direct: 'blocked', reason: 'cors' });
});

it('draws no conclusion from upstream errors', async () => {
  mockFetch.mockResolvedValueOnce(segmentResponse({}, 403));
  mockFetch.mockRejectedValueOnce(new Error('timeout'));
  for (let i = 0; i < 2; i++) {
    await expect(
      capability.probeSourceDirectCapability({
        segmentUrl: 'https://cdn.example/a.ts',
        pageOrigin: 'https://tv.example',
        userAgent: 'ua',
      }),
    ).resolves.toBeNull();
  }
});

it('shares scheduled probe results and throttles repeated probes', async () => {
  mockFetch.mockResolvedValue(segmentResponse());
  const input = {
    source: 'site-a',
    playlistContent: PLAYLIST,
    playlistUrl: 'https://cdn.example/v/index.m3u8',
    referer: 'https://tv.example/play?id=1',
    userAgent: 'ua',
  };
  capability.scheduleSourceDirectProbe(input);
  await flushProbe();
  capability.scheduleSourceDirectProbe(input);
  await flushProbe();

  expect(mockFetch).toHaveBeenCalledTimes(1);
  capability.resetSourceRouteCapabilityForTests();
  const shared = await capability.getSourceRouteCapabilities();
  expect(shared['site-a']).toMatchObject({ direct: 'blocked', reason: 'cors' });
  expect(capability.isSourceDirectBlocked(shared, 'site-a')).toBe(true);
});

it('skips probing without a page origin', async () => {
  capability.scheduleSourceDirectProbe({
    source: 'site-a',
    playlistContent: PLAYLIST,
    playlistUrl: 'https://cdn.example/v/index.m3u8',
    referer: null,
    userAgent: 'ua',
  });
  await flushProbe();
  expect(mockFetch).not.toHaveBeenCalled();
});

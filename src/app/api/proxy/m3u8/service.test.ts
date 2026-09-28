/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

jest.mock('@/features/play/lib/ad-filter-strategy-registry', () => ({
  getAdFilterCacheNamespace: (source: string | null) => `test:${source ?? ''}`,
}));
jest.mock('@/features/play/lib/ad-segment-detector', () => ({
  filterM3U8AdsForSource: async (content: string) => content,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => ({ SiteConfig: {} }),
}));
jest.mock('@/lib/http-proxy-json', () => ({
  fetchResponseThroughProxy: jest.fn(),
  getProxyUrlForTarget: () => undefined,
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (url: string) => mockFetch(url),
}));

const mockFetch = jest.fn();
installStreamPolyfills();
const { loadM3U8Data, peekM3U8Cache } =
  require('@/app/api/proxy/m3u8/service') as typeof import('@/app/api/proxy/m3u8/service');

const START = 1_000_000;
const MINUTE = 60 * 1000;
const SOURCE = 'demo';

function mediaPlaylist(segmentUri: string): string {
  return [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:10',
    '#EXTINF:10,',
    segmentUri,
    '#EXT-X-ENDLIST',
  ].join('\n');
}

async function load(url: string, content: string): Promise<void> {
  mockFetch.mockResolvedValueOnce(
    new Response(content, {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    }),
  );
  await loadM3U8Data(url, 'IceTV Test', SOURCE, false, false, {
    startedAt: START,
    proxyMode: 'server-proxy',
    userAction: null,
    userInitiated: false,
  });
}

describe('m3u8 cache ttl', () => {
  let clock: jest.SpyInstance<number, []>;

  beforeEach(() => {
    mockFetch.mockReset();
    clock = jest.spyOn(Date, 'now').mockReturnValue(START);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps ended media playlists without signed params for thirty minutes', async () => {
    const url = 'https://cdn.example/vod/ended/index.m3u8';
    await load(url, mediaPlaylist('seg-1.ts'));

    clock.mockReturnValue(START + 19 * MINUTE);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: true });
    clock.mockReturnValue(START + 25 * MINUTE);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: false });
    clock.mockReturnValue(START + 30 * MINUTE + 1);
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
  });

  it.each([
    [
      'signed segment urls',
      'https://cdn.example/vod/signed/index.m3u8',
      mediaPlaylist('seg-1.ts?token=abc&expires=1700000000'),
    ],
    [
      'master playlists',
      'https://cdn.example/vod/master/index.m3u8',
      ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=800000', 'low/index.m3u8'].join(
        '\n',
      ),
    ],
  ])('keeps the one minute ttl for %s', async (_label, url, content) => {
    await load(url, content);

    clock.mockReturnValue(START + 59_000);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: true });
    clock.mockReturnValue(START + 90_000);
    expect(peekM3U8Cache(url, SOURCE)).toMatchObject({ fresh: false });
    clock.mockReturnValue(START + 120_000);
    expect(peekM3U8Cache(url, SOURCE)).toBeNull();
  });
});

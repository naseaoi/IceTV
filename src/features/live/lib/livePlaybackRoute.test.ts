import {
  buildLiveM3u8ProxyUrl,
  isDirectLiveRequestUrl,
  isLivePlaylistContextType,
  rememberLiveServerRoute,
  resolveInitialLiveRoute,
  rewriteLivePlaylistRequestUrl,
} from './livePlaybackRoute';

describe('live playback route', () => {
  it('builds browser-direct and forced-server playlist URLs', () => {
    const browserUrl = buildLiveM3u8ProxyUrl({
      rawUrl: 'https://stream.example/live.m3u8?token=a',
      sourceKey: 'source-a',
      route: 'browser',
    });
    const browserParams = new URL(browserUrl, 'http://localhost').searchParams;

    expect(browserParams.get('allowCORS')).toBe('true');
    expect(browserParams.get('forceServer')).toBeNull();
    expect(browserParams.get('icetv-live')).toBe('1');
    expect(browserParams.get('icetv-source')).toBe('source-a');

    const serverUrl = buildLiveM3u8ProxyUrl({
      rawUrl: 'https://stream.example/live.m3u8',
      sourceKey: 'source-a',
      route: 'server',
    });
    const serverParams = new URL(serverUrl, 'http://localhost').searchParams;

    expect(serverParams.get('forceServer')).toBe('true');
    expect(serverParams.get('allowCORS')).toBeNull();
  });

  it('normalizes nested same-origin playlist requests to the active route', () => {
    const directUrl = rewriteLivePlaylistRequestUrl(
      '/api/proxy/m3u8?url=https%3A%2F%2Fstream.example%2Flevel.m3u8&forceServer=true',
      {
        sourceKey: 'source-a',
        route: 'browser',
        origin: 'http://localhost',
      },
    );
    const directParams = new URL(directUrl).searchParams;

    expect(directParams.get('allowCORS')).toBe('true');
    expect(directParams.get('forceServer')).toBeNull();
    expect(directParams.get('icetv-live')).toBe('1');

    const serverUrl = rewriteLivePlaylistRequestUrl(
      'http://localhost/api/proxy/m3u8?url=x&allowCORS=true',
      {
        sourceKey: 'source-a',
        route: 'server',
        origin: 'http://localhost',
      },
    );
    const serverParams = new URL(serverUrl).searchParams;
    expect(serverParams.get('forceServer')).toBe('true');
    expect(serverParams.get('allowCORS')).toBeNull();
  });

  it('does not rewrite an external playlist URL', () => {
    const url = 'https://stream.example/live/level.m3u8';
    expect(
      rewriteLivePlaylistRequestUrl(url, {
        sourceKey: 'source-a',
        route: 'browser',
        origin: 'http://localhost',
      }),
    ).toBe(url);
  });

  it('wraps an external playlist when server mode is active', () => {
    const result = rewriteLivePlaylistRequestUrl(
      'https://stream.example/live/audio.m3u8',
      {
        sourceKey: 'source-a',
        route: 'server',
        origin: 'http://localhost',
      },
    );
    const resultUrl = new URL(result, 'http://localhost');

    expect(resultUrl.pathname).toBe('/api/proxy/m3u8');
    expect(resultUrl.searchParams.get('url')).toBe(
      'https://stream.example/live/audio.m3u8',
    );
    expect(resultUrl.searchParams.get('forceServer')).toBe('true');
    expect(resultUrl.searchParams.get('allowCORS')).toBeNull();
  });

  it('recognizes playlist request types', () => {
    expect(isLivePlaylistContextType('manifest')).toBe(true);
    expect(isLivePlaylistContextType('level')).toBe(true);
    expect(isLivePlaylistContextType('fragment')).toBe(false);
  });
});

describe('initial live route', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('sends http streams on https pages through the server', () => {
    expect(
      resolveInitialLiveRoute('http://1.2.3.4:9901/live.m3u8', {
        pageProtocol: 'https:',
      }),
    ).toBe('server');
    expect(
      resolveInitialLiveRoute('http://1.2.3.4:9901/live.m3u8', {
        pageProtocol: 'http:',
      }),
    ).toBe('browser');
  });

  it('tries https streams directly until the host is remembered as failing', () => {
    const url = 'https://cdn-a.example/live.m3u8';
    expect(resolveInitialLiveRoute(url, { pageProtocol: 'https:' })).toBe(
      'browser',
    );

    rememberLiveServerRoute('https://cdn-a.example/other.m3u8', 1_000);
    expect(
      resolveInitialLiveRoute(url, { pageProtocol: 'https:', now: 2_000 }),
    ).toBe('server');
    expect(
      resolveInitialLiveRoute('https://cdn-b.example/live.m3u8', {
        pageProtocol: 'https:',
        now: 2_000,
      }),
    ).toBe('browser');
    expect(
      resolveInitialLiveRoute(url, {
        pageProtocol: 'https:',
        now: 1_000 + 31 * 60 * 1000,
      }),
    ).toBe('browser');
  });

  it('distinguishes direct requests from proxied ones', () => {
    const origin = 'https://tv.example';
    expect(isDirectLiveRequestUrl('https://cdn.example/seg.ts', origin)).toBe(
      true,
    );
    expect(isDirectLiveRequestUrl('/api/proxy/segment?url=x', origin)).toBe(
      false,
    );
    expect(isDirectLiveRequestUrl(undefined, origin)).toBe(false);
  });
});

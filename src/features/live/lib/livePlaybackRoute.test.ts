import {
  buildLiveM3u8ProxyUrl,
  isLivePlaylistContextType,
  isLiveRouteNetworkError,
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

  it('recognizes playlist request types and direct-route network failures', () => {
    expect(isLivePlaylistContextType('manifest')).toBe(true);
    expect(isLivePlaylistContextType('level')).toBe(true);
    expect(isLivePlaylistContextType('fragment')).toBe(false);

    const errorTypes = { NETWORK_ERROR: 'networkError' };
    expect(
      isLiveRouteNetworkError(
        { type: 'networkError', details: 'manifestLoadError' },
        errorTypes,
      ),
    ).toBe(true);
    expect(
      isLiveRouteNetworkError(
        { type: 'networkError', details: 'fragLoadError' },
        errorTypes,
      ),
    ).toBe(true);
    expect(
      isLiveRouteNetworkError(
        { type: 'mediaError', details: 'bufferStalledError', fatal: true },
        errorTypes,
      ),
    ).toBe(false);
  });
});

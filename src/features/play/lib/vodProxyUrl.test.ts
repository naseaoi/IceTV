import { buildVodProxyUrl } from '@/features/play/lib/vodProxyUrl';
import { getSourcePlaybackRoute } from '@/lib/proxy-modes';

const rawUrl = 'https://cdn.example/show/master.m3u8?token=a%2Fb#part';

it.each(['browser', 'server', 'auto'])(
  '%s 清单地址遵守完整线路语义',
  (mode) => {
    const url = buildVodProxyUrl({
      rawUrl,
      ...getSourcePlaybackRoute('demo', rawUrl, { demo: mode }),
      sourceKey: 'demo',
      playbackRequestMode: 'episode',
    });
    if (mode !== 'server') {
      expect(url).toBe(rawUrl);
      return;
    }
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toBe('/api/proxy/m3u8');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      url: rawUrl,
      [mode === 'server' ? 'forceServer' : 'allowCORS']: 'true',
      'icetv-source': 'demo',
      'icetv-switch': 'episode',
      'icetv-user-switch': '0',
    });
  },
);

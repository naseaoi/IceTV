import { removeConfigFileEntries } from '../config-file-json';

describe('removeConfigFileEntries', () => {
  it('removes video source entries from api_site', () => {
    const configFile = JSON.stringify({
      cache_time: 7200,
      api_site: {
        giri: { name: 'giri资源', api: 'https://ani.girigirilove.com' },
        other: { name: '其它源', api: 'https://example.com' },
      },
      lives: {
        iptv: { name: 'IPTV', url: 'https://example.com/live.m3u' },
      },
    });

    const result = JSON.parse(
      removeConfigFileEntries(configFile, 'api_site', ['giri']),
    );

    expect(result.api_site).toEqual({
      other: { name: '其它源', api: 'https://example.com' },
    });
    expect(result.lives).toEqual({
      iptv: { name: 'IPTV', url: 'https://example.com/live.m3u' },
    });
  });

  it('removes live source entries from lives', () => {
    const configFile = JSON.stringify({
      api_site: {
        giri: { name: 'giri资源', api: 'https://ani.girigirilove.com' },
      },
      lives: {
        iptv: { name: 'IPTV', url: 'https://example.com/live.m3u' },
        other: { name: '其它直播', url: 'https://example.com/other.m3u' },
      },
    });

    const result = JSON.parse(
      removeConfigFileEntries(configFile, 'lives', ['iptv']),
    );

    expect(result.lives).toEqual({
      other: { name: '其它直播', url: 'https://example.com/other.m3u' },
    });
    expect(result.api_site).toEqual({
      giri: { name: 'giri资源', api: 'https://ani.girigirilove.com' },
    });
  });

  it('keeps invalid JSON unchanged', () => {
    const configFile = '{invalid';

    expect(removeConfigFileEntries(configFile, 'api_site', ['giri'])).toBe(
      configFile,
    );
  });
});

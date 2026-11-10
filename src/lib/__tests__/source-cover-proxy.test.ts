import {
  buildSourceCoverProxyUrl,
  normalizeSourceCoverProxyMode,
  rememberSourceCoverDirectHost,
  shouldProxySourceCover,
  SOURCE_COVER_DIRECT_HOST_TTL_MS,
} from '@/lib/source-cover-proxy';

describe('source cover proxy', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('normalizes unsupported modes to auto', () => {
    expect(normalizeSourceCoverProxyMode('invalid')).toBe('auto');
  });

  it('builds a stable encoded proxy URL', () => {
    expect(buildSourceCoverProxyUrl('https://example.com/a.jpg?x=1')).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg%3Fx%3D1',
    );
  });

  it('auto 模式在本标签页记住改用直连的域名', () => {
    const firstUrl = 'https://covers.example.com/a.jpg';
    const secondUrl = 'https://covers.example.com/b.jpg';

    expect(shouldProxySourceCover(firstUrl, 'auto')).toBe(true);
    rememberSourceCoverDirectHost(firstUrl);
    expect(shouldProxySourceCover(secondUrl, 'auto')).toBe(false);
    expect(shouldProxySourceCover(secondUrl, 'server')).toBe(true);
    expect(
      shouldProxySourceCover('https://other.example.com/a.jpg', 'auto'),
    ).toBe(true);
  });

  it('到期后重新尝试服务端代理', () => {
    const url = 'https://covers.example.com/a.jpg';
    const rememberedAt = Date.now();
    rememberSourceCoverDirectHost(url, rememberedAt);

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(rememberedAt + SOURCE_COVER_DIRECT_HOST_TTL_MS - 1);
    expect(shouldProxySourceCover(url, 'auto')).toBe(false);
    nowSpy.mockReturnValue(rememberedAt + SOURCE_COVER_DIRECT_HOST_TTL_MS);
    expect(shouldProxySourceCover(url, 'auto')).toBe(true);
    nowSpy.mockRestore();
  });

  it('忽略格式不符的存储内容', () => {
    sessionStorage.setItem(
      'icetv:source-cover-direct-hosts',
      JSON.stringify(['covers.example.com']),
    );
    expect(
      shouldProxySourceCover('https://covers.example.com/a.jpg', 'auto'),
    ).toBe(true);
  });
});

import {
  buildSourceCoverProxyUrl,
  markSourceCoverProxyHostFailed,
  normalizeSourceCoverProxyMode,
  shouldProxySourceCover,
  SOURCE_COVER_PROXY_FAILURE_COOLDOWN_MS,
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

  it('remembers failed hosts for auto mode in the current session', () => {
    const firstUrl = 'https://covers.example.com/a.jpg';
    const secondUrl = 'https://covers.example.com/b.jpg';

    expect(shouldProxySourceCover(firstUrl, 'auto')).toBe(true);
    markSourceCoverProxyHostFailed(firstUrl);
    expect(shouldProxySourceCover(secondUrl, 'auto')).toBe(false);
    expect(shouldProxySourceCover(secondUrl, 'server')).toBe(true);
  });

  it('retries the proxy for a failed host after the cooldown', () => {
    const url = 'https://covers.example.com/a.jpg';
    const failedAt = Date.now();
    markSourceCoverProxyHostFailed(url, failedAt);

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(
      failedAt + SOURCE_COVER_PROXY_FAILURE_COOLDOWN_MS - 1,
    );
    expect(shouldProxySourceCover(url, 'auto')).toBe(false);
    nowSpy.mockReturnValue(failedAt + SOURCE_COVER_PROXY_FAILURE_COOLDOWN_MS);
    expect(shouldProxySourceCover(url, 'auto')).toBe(true);
    nowSpy.mockRestore();
  });

  it('ignores the legacy host-only storage format', () => {
    sessionStorage.setItem(
      'icetv:source-cover-proxy-failed-hosts',
      JSON.stringify(['covers.example.com']),
    );
    expect(
      shouldProxySourceCover('https://covers.example.com/a.jpg', 'auto'),
    ).toBe(true);
  });
});

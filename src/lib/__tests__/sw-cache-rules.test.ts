import {
  excludeDefaultApiRuntimeCache,
  shouldHandleBangumiCoverCache,
  shouldHandleExternalCoverCache,
  shouldHandleImageProxyCache,
  shouldHandleNextImageCache,
  shouldHandleVodSegmentCache,
} from '../sw-cache-rules';

describe('excludeDefaultApiRuntimeCache', () => {
  it('removes the default same-origin api cache rule', () => {
    const apiRule = {
      matcher: () => true,
      handler: { cacheName: 'apis' },
    };
    const otherRule = {
      matcher: () => true,
      handler: {},
    };

    expect(excludeDefaultApiRuntimeCache([apiRule, otherRule])).toEqual([
      otherRule,
    ]);
  });
});

describe('shouldHandleVodSegmentCache', () => {
  const baseInput = {
    sameOrigin: true,
    method: 'GET',
    pathname: '/api/proxy/segment',
    liveFlag: null,
    hasRangeHeader: false,
  };

  it('allows complete same-origin vod segment requests', () => {
    expect(shouldHandleVodSegmentCache(baseInput)).toBe(true);
  });

  it('skips range and live segment requests', () => {
    expect(
      shouldHandleVodSegmentCache({ ...baseInput, hasRangeHeader: true }),
    ).toBe(false);
    expect(shouldHandleVodSegmentCache({ ...baseInput, liveFlag: '1' })).toBe(
      false,
    );
  });
});

describe('cover image cache matchers', () => {
  it('matches optimized and proxied cover requests', () => {
    expect(
      shouldHandleNextImageCache({
        pathname: '/_next/image',
        search: '?url=https%3A%2F%2Fexample.com%2Fa.jpg&w=180&q=72',
      }),
    ).toBe(true);
    expect(
      shouldHandleImageProxyCache({
        pathname: '/api/image-proxy',
        search: '?url=https%3A%2F%2Fexample.com%2Fa.jpg',
      }),
    ).toBe(true);
    expect(
      shouldHandleBangumiCoverCache({
        pathname: '/api/bangumi-cover/l/27/ff/377130_wDU1x.jpg',
      }),
    ).toBe(true);
  });

  it('matches supported external cover hosts only', () => {
    expect(
      shouldHandleExternalCoverCache({ hostname: 'img1.doubanio.com' }),
    ).toBe(true);
    expect(shouldHandleExternalCoverCache({ hostname: 'lain.bgm.tv' })).toBe(
      true,
    );
    expect(
      shouldHandleExternalCoverCache({
        hostname: 'img.doubanio.cmliussss.net',
      }),
    ).toBe(true);
    expect(shouldHandleExternalCoverCache({ hostname: 'example.com' })).toBe(
      false,
    );
  });
});

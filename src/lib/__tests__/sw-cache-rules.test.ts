import {
  composeRuntimeCaching,
  shouldBypassCrossOriginImageCache,
  shouldHandleBangumiCoverCache,
  shouldHandleImageProxyCache,
  shouldHandleVodSegmentCache,
} from '../sw-cache-rules';

describe('composeRuntimeCaching', () => {
  it('places custom rules before defaults and drops the default api cache', () => {
    const customRule = { matcher: () => true, handler: { cacheName: 'mine' } };
    const apiRule = { matcher: () => true, handler: { cacheName: 'apis' } };
    const catchAllRule = { matcher: /.*/i, handler: {} };

    expect(
      composeRuntimeCaching([customRule], [apiRule, catchAllRule]),
    ).toEqual([customRule, catchAllRule]);
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
  it('matches proxied and bangumi cover requests', () => {
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
});

describe('shouldBypassCrossOriginImageCache', () => {
  it('bypasses cross-origin images only', () => {
    expect(
      shouldBypassCrossOriginImageCache({
        sameOrigin: false,
        destination: 'image',
      }),
    ).toBe(true);
    expect(
      shouldBypassCrossOriginImageCache({
        sameOrigin: true,
        destination: 'image',
      }),
    ).toBe(false);
    expect(
      shouldBypassCrossOriginImageCache({
        sameOrigin: false,
        destination: 'font',
      }),
    ).toBe(false);
  });
});

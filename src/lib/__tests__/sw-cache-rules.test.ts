import {
  excludeDefaultApiRuntimeCache,
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

import { excludeDefaultApiRuntimeCache } from '../sw-cache-rules';

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

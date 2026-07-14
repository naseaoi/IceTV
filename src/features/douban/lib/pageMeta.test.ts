import { normalizeDoubanType } from '@/features/douban/lib/pageMeta';

describe('normalizeDoubanType', () => {
  it.each(['movie', 'tv', 'show', 'anime', 'custom'])(
    '保留合法分区类型 %s',
    (type) => {
      expect(normalizeDoubanType(type)).toBe(type);
    },
  );

  it.each([undefined, null, '', 'invalid', ['tv']])(
    '非法分区类型回退到电影',
    (type) => {
      expect(normalizeDoubanType(type)).toBe('movie');
    },
  );
});

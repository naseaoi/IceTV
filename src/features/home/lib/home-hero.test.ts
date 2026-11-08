import type { DoubanItem } from '@/lib/types';

import { parseDoubanCardSubtitle, pickHomeHeroItems } from './home-hero';

function item(id: string, rate: string, poster = `p${id}.jpg`): DoubanItem {
  return { id, title: `t${id}`, poster, rate, year: '2025' };
}

describe('pickHomeHeroItems', () => {
  it('电影与剧集交替取高分条目', () => {
    const picked = pickHomeHeroItems(
      [item('m1', '8.0'), item('m2', '6.0'), item('m3', '7.5')],
      [item('t1', '7.2'), item('t2', '9.1')],
    );

    expect(picked.map((entry) => entry.id)).toEqual([
      'm1',
      't1',
      't2',
      'm3',
      'm2',
    ]);
    expect(picked[0]).toMatchObject({ label: '电影', type: 'movie' });
    expect(picked[1]).toMatchObject({ label: '剧集' });
    expect(picked[1].type).toBeUndefined();
  });

  it('跳过无海报条目并限制数量', () => {
    const movies = Array.from({ length: 6 }, (_, i) => item(`m${i}`, '8.0'));
    const picked = pickHomeHeroItems(movies, [item('t0', '9.0', '')]);

    expect(picked).toHaveLength(5);
    expect(picked.some((entry) => entry.id === 't0')).toBe(false);
  });
});

describe('parseDoubanCardSubtitle', () => {
  it('按年份、地区、类型、导演、主演拆分', () => {
    expect(
      parseDoubanCardSubtitle(
        '2026 / 中国大陆 / 剧情 爱情 / 杨龙 / 田曦薇 闫桉',
      ),
    ).toEqual({
      region: '中国大陆',
      genres: ['剧情', '爱情'],
      directors: '杨龙',
      actors: '田曦薇 闫桉',
    });
  });

  it('缺少字段时只返回已有部分', () => {
    expect(parseDoubanCardSubtitle('2025 / 日本')).toEqual({
      region: '日本',
      genres: undefined,
      directors: undefined,
      actors: undefined,
    });
    expect(parseDoubanCardSubtitle('')).toEqual({
      region: undefined,
      genres: undefined,
      directors: undefined,
      actors: undefined,
    });
  });
});

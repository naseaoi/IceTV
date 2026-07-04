import {
  normalizeDoubanCategoryItems,
  normalizeDoubanListSubjects,
  normalizeDoubanRecommendItems,
} from '../douban-normalize';

describe('douban normalizers', () => {
  it('normalizes recent hot category items', () => {
    expect(
      normalizeDoubanCategoryItems([
        {
          id: '1',
          title: '动画',
          card_subtitle: '2026 / 日本',
          pic: { normal: 'normal.jpg', large: 'large.jpg' },
          rating: { value: 8.6 },
        },
      ]),
    ).toEqual([
      {
        id: '1',
        title: '动画',
        poster: 'normal.jpg',
        rate: '8.6',
        year: '2026',
      },
    ]);
  });

  it('normalizes list subjects', () => {
    expect(
      normalizeDoubanListSubjects([
        {
          id: '2',
          title: '电影',
          cover: 'cover.jpg',
          rate: '7.8',
          card_subtitle: '2025 / 剧情',
        },
      ]),
    ).toEqual([
      {
        id: '2',
        title: '电影',
        poster: 'cover.jpg',
        rate: '7.8',
        year: '2025',
      },
    ]);
  });

  it('normalizes recommend items and filters unsupported types', () => {
    expect(
      normalizeDoubanRecommendItems([
        {
          id: '3',
          title: '剧集',
          year: '2024',
          type: 'tv',
          pic: { large: 'large.jpg' },
          rating: { value: 9.1 },
        },
        {
          id: '4',
          title: '图书',
          year: '2024',
          type: 'book',
          pic: { normal: 'book.jpg' },
          rating: { value: 9.5 },
        },
      ]),
    ).toEqual([
      {
        id: '3',
        title: '剧集',
        poster: 'large.jpg',
        rate: '9.1',
        year: '2024',
      },
    ]);
  });
});

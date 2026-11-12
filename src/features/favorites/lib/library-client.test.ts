import type { Favorite, PlayRecord } from '@/lib/types';

import { toFavoriteItem } from './library-client';

const favorite = {
  title: '三体',
  year: '2023',
  cover: '',
  source_name: '源',
  total_episodes: 30,
  save_time: 1,
} as Favorite;

describe('toFavoriteItem 追更归属', () => {
  it('同键播放记录接管追更', () => {
    const item = toFavoriteItem({
      key: 'src+1',
      favorite: { ...favorite, tracking_enabled: true },
      playRecord: { tracking_enabled: false } as PlayRecord,
    });
    expect(item).toMatchObject({
      trackingTarget: 'record',
      trackingEnabled: false,
    });
  });

  it('没有播放记录时读取收藏自己的开关，缺省为开启', () => {
    expect(toFavoriteItem({ key: 'src+1', favorite })).toMatchObject({
      trackingTarget: 'favorite',
      trackingEnabled: true,
    });
    expect(
      toFavoriteItem({
        key: 'src+1',
        favorite: { ...favorite, tracking_enabled: false },
      }),
    ).toMatchObject({ trackingTarget: 'favorite', trackingEnabled: false });
  });

  it('目录与直播收藏不提供追更', () => {
    expect(
      toFavoriteItem({ key: 'douban+1', favorite })?.trackingTarget,
    ).toBeUndefined();
    expect(
      toFavoriteItem({
        key: 'src+1',
        favorite: { ...favorite, origin: 'live' },
      })?.trackingTarget,
    ).toBeUndefined();
  });
});

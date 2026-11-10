import {
  mergeFavorite,
  validateFavoriteBatch,
} from '@/features/favorites/lib/library-mutations';
import { normalizeFavoriteWatchFields } from '@/lib/catalog-favorites';
import type { Favorite } from '@/lib/types';

const favorite: Favorite = {
  title: '测试',
  year: '2026',
  source_name: '源',
  total_episodes: 1,
  cover: '',
  save_time: 100,
};
const row = (key: string, value: Favorite) => ({
  favorite_key: key,
  favorite_json: JSON.stringify(value),
});

it('真实源吸收目录状态和更早保存时间', () => {
  expect(
    mergeFavorite('source+1', favorite, [
      row('douban+2', {
        ...favorite,
        save_time: 50,
        watch_status: 'completed',
        watched_at: 20,
      }),
    ]),
  ).toEqual({
    key: 'source+1',
    favorite: {
      ...favorite,
      update_baseline_episodes: 1,
      save_time: 50,
      watch_status: 'completed',
      watched_at: 20,
    },
    removeKeys: ['douban+2'],
  });
});

it('目录写入优先落到真实源并保留其元数据', () => {
  const result = mergeFavorite(
    'bangumi+2',
    { ...favorite, watch_status: 'planned' },
    [row('source+1', { ...favorite, cover: 'real.jpg' })],
  );
  expect(result.key).toBe('source+1');
  expect(result.favorite).toMatchObject({
    cover: 'real.jpg',
    watch_status: 'planned',
  });
});

it('真实源之间保留独立收藏，目录之间按作品合并', () => {
  expect(
    mergeFavorite('source+2', favorite, [row('source+1', favorite)]).removeKeys,
  ).toEqual([]);
  expect(
    mergeFavorite('bangumi+2', favorite, [row('douban+1', favorite)]).key,
  ).toBe('douban+1');
});

it.each([
  { watch_status: 'invalid', watched_at: 123 },
  { watch_status: 'completed', watched_at: -1 },
  { watch_status: 'planned', watched_at: 123 },
])('归一化丢弃非法状态或无意义日期 %j', (value) => {
  const normalized = normalizeFavoriteWatchFields(value);
  expect(normalized.watched_at).toBeUndefined();
  if (value.watch_status === 'invalid')
    expect(normalized.watch_status).toBeUndefined();
});

it('归一化保留合法状态与日期', () => {
  expect(
    normalizeFavoriteWatchFields({
      watch_status: 'completed',
      watched_at: 123,
    }),
  ).toEqual({ watch_status: 'completed', watched_at: 123 });
});

it.each([
  { action: 'set-status', target: { keys: ['source+1'] } },
  { action: 'set-status', target: { keys: ['source+1'] }, watchStatus: 'bad' },
  { action: 'remove', target: { keys: Array(501).fill('source+1') } },
  { action: 'remove', target: { keys: ['invalid'] } },
  {
    action: 'remove',
    target: { match: { q: '', filter: 'watched' }, exclude: [] },
  },
])('批量入口拒绝非法参数 %j', (value) => {
  expect(() => validateFavoriteBatch(value)).toThrow('参数无效');
});

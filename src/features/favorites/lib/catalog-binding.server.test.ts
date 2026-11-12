/** @jest-environment node */

import type { ActiveUserInfo } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolvePlayableSourceForUser } from '@/lib/quick-search.server';
import type { Favorite } from '@/lib/types';

import {
  bindCatalogFavorite,
  bindDueCatalogFavorites,
} from './catalog-binding.server';
import { CATALOG_BIND_SNAPSHOT, mergeFavorite } from './library-mutations';

jest.mock('@/lib/db', () => ({
  db: {
    getFavorite: jest.fn(),
    saveFavorite: jest.fn(),
    saveFavoriteIfUnchanged: jest.fn(),
    getFavoriteLibraryPage: jest.fn(),
  },
}));
jest.mock('@/lib/quick-search.server', () => ({
  resolvePlayableSourceForUser: jest.fn(),
}));

const user: ActiveUserInfo = {
  username: 'alice',
  role: 'user',
  isOwner: false,
};
const favorite: Favorite = {
  title: 'Show',
  year: '2026',
  total_episodes: 100,
  source_name: '豆瓣',
  save_time: 10,
  cover: 'catalog.jpg',
  watch_status: 'watching',
};
const detail = {
  source: 'allowed',
  id: '1',
  source_name: 'Allowed',
  title: 'Show',
  year: '2026',
  episodes: ['one', 'two'],
  series_status: 'ongoing',
};

beforeEach(() => {
  jest.clearAllMocks();
  (db.getFavorite as jest.Mock).mockResolvedValue(favorite);
  (db.saveFavoriteIfUnchanged as jest.Mock).mockResolvedValue(true);
  (db.saveFavorite as jest.Mock).mockResolvedValue('allowed+1');
  (resolvePlayableSourceForUser as jest.Mock).mockResolvedValue({ detail });
});

it('binds a matching playable source with catalog identity and the new episode baseline', async () => {
  await expect(bindCatalogFavorite(user, 'douban+1')).resolves.toEqual({
    status: 'bound',
    key: 'allowed+1',
  });
  expect(resolvePlayableSourceForUser).toHaveBeenCalledWith(
    expect.objectContaining({
      user,
      query: 'Show',
      year: '2026',
      requireFullDetail: true,
    }),
  );
  const incoming = (db.saveFavorite as jest.Mock).mock.calls[0][3];
  const merged = mergeFavorite('allowed+1', incoming, [
    { favorite_key: 'douban+1', favorite_json: JSON.stringify(favorite) },
  ]);
  expect(merged.favorite).toMatchObject({
    watch_status: 'watching',
    save_time: 10,
    total_episodes: 2,
    update_baseline_episodes: 2,
    catalog_origin: { key: 'douban+1', title: 'Show', year: '2026' },
  });
  expect(merged.removeKeys).toEqual(['douban+1']);
  expect(incoming[CATALOG_BIND_SNAPSHOT]).toEqual({
    key: 'douban+1',
    snapshot: favorite,
  });
});

it.each(['', 'unknown'])(
  'skips a missing year %s without searching',
  async (year) => {
    (db.getFavorite as jest.Mock).mockResolvedValue({ ...favorite, year });
    expect(await bindCatalogFavorite(user, 'douban+1')).toEqual({
      status: 'skipped',
      key: 'douban+1',
    });
    expect(resolvePlayableSourceForUser).not.toHaveBeenCalled();
    expect(db.saveFavoriteIfUnchanged).toHaveBeenCalledWith(
      'alice',
      'douban',
      '1',
      expect.objectContaining({
        catalog_bind: expect.objectContaining({ status: 'skipped' }),
      }),
      expect.any(String),
    );
  },
);

it.each([
  { ...detail, series_status: 'ended' },
  {
    ...detail,
    series_status: undefined,
    episodes: ['movie'],
    type_name: '电影',
  },
])('skips ended series and single-episode movies', async (ended) => {
  (resolvePlayableSourceForUser as jest.Mock).mockResolvedValue({
    detail: ended,
  });
  expect((await bindCatalogFavorite(user, 'douban+1')).status).toBe('skipped');
  expect(db.saveFavorite).not.toHaveBeenCalled();
});

it.each([
  null,
  { ...detail, year: 'unknown' },
  { ...detail, year: '2025' },
  { ...detail, title: 'Another' },
  { ...detail, episodes: [] },
])(
  'records retry backoff when no exact playable match exists',
  async (candidate) => {
    (resolvePlayableSourceForUser as jest.Mock).mockResolvedValue({
      detail: candidate,
    });
    const now = Date.now();
    expect((await bindCatalogFavorite(user, 'douban+1')).status).toBe('failed');
    const saved = (db.saveFavoriteIfUnchanged as jest.Mock).mock.calls[0][3];
    expect(saved.catalog_bind).toMatchObject({ status: 'failed', attempts: 1 });
    expect(saved.catalog_bind.retry_at).toBeGreaterThanOrEqual(
      now + 30 * 60_000,
    );
    expect(db.saveFavorite).not.toHaveBeenCalled();
  },
);

it('respects skipped and not-yet-due attempts', async () => {
  for (const catalog_bind of [
    { status: 'skipped' },
    { status: 'failed', retry_at: Date.now() + 10000 },
  ]) {
    (db.getFavorite as jest.Mock).mockResolvedValue({
      ...favorite,
      catalog_bind,
    });
    await bindCatalogFavorite(user, 'douban+1');
  }
  expect(resolvePlayableSourceForUser).not.toHaveBeenCalled();
});

it('does not bind a real source key or a deleted favorite', async () => {
  expect((await bindCatalogFavorite(user, 'real+1')).status).toBe(
    'not-catalog',
  );
  expect(db.getFavorite).not.toHaveBeenCalled();
  (db.getFavorite as jest.Mock).mockResolvedValue(null);
  expect((await bindCatalogFavorite(user, 'douban+1')).status).toBe(
    'not-catalog',
  );
});

it('selects at most two due catalog favorites across pages', async () => {
  (db.getFavoriteLibraryPage as jest.Mock)
    .mockResolvedValueOnce({
      items: [
        { key: 'real+1', favorite },
        {
          key: 'douban+1',
          favorite: { ...favorite, catalog_bind: { status: 'skipped' } },
        },
        {
          key: 'douban+2',
          favorite: {
            ...favorite,
            catalog_bind: { status: 'failed', retry_at: Date.now() + 100000 },
          },
        },
        { key: 'douban+3', favorite },
      ],
      nextCursor: 'next',
    })
    .mockResolvedValueOnce({
      items: [
        { key: 'bangumi+4', favorite },
        { key: 'douban+5', favorite },
      ],
      nextCursor: null,
    });
  expect(await bindDueCatalogFavorites(user)).toHaveLength(2);
  expect((db.getFavorite as jest.Mock).mock.calls).toEqual([
    ['alice', 'douban', '3'],
    ['alice', 'bangumi', '4'],
  ]);
});

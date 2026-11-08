import { cookies } from 'next/headers';

import { getFavoriteSkeletonCount } from '@/lib/favorites.server';
import {
  clampFavoriteSkeletonCount,
  FAVORITE_PREVIEW_LIMIT,
  FAVORITE_RENDER_CHUNK,
} from '@/lib/favorites-count';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));

it.each([-1, NaN, Infinity])('无效收藏计数 %s 保留空态', (value) => {
  expect(clampFavoriteSkeletonCount(value, FAVORITE_PREVIEW_LIMIT)).toBe(0);
});

it('预览与完整收藏页使用各自实际显示上限', async () => {
  jest
    .mocked(cookies)
    .mockResolvedValue({ get: () => ({ value: '100' }) } as never);
  expect(await getFavoriteSkeletonCount()).toBe(FAVORITE_PREVIEW_LIMIT);
  expect(await getFavoriteSkeletonCount(FAVORITE_RENDER_CHUNK)).toBe(
    FAVORITE_RENDER_CHUNK,
  );
});

it('已有六条计数返回六个，不补满默认行', async () => {
  jest
    .mocked(cookies)
    .mockResolvedValue({ get: () => ({ value: '6' }) } as never);
  expect(await getFavoriteSkeletonCount()).toBe(6);
});

it('无计数时保持空态占位', async () => {
  jest.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
  expect(await getFavoriteSkeletonCount()).toBe(0);
});

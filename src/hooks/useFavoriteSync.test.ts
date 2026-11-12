import { act, renderHook } from '@testing-library/react';

import { useFavoriteSync } from '@/hooks/useFavoriteSync';
import { isFavorited } from '@/lib/db.client';

jest.mock('@/lib/db.client', () => ({
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  isFavorited: jest.fn(),
  subscribeToDataUpdates: (name: string, callback: (data: unknown) => void) => {
    const listener = (event: Event) => callback((event as CustomEvent).detail);
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  },
}));

beforeEach(() => jest.clearAllMocks());

it('换源后忽略旧源收藏读取结果', async () => {
  let resolve!: (value: boolean) => void;
  jest
    .mocked(isFavorited)
    .mockImplementationOnce(
      () =>
        new Promise((settle) => {
          resolve = settle;
        }),
    )
    .mockResolvedValueOnce(false);
  const setFavorited = jest.fn();
  const { rerender } = renderHook(
    ({ source }) => useFavoriteSync(source, '1', setFavorited),
    { initialProps: { source: 'a' } },
  );
  rerender({ source: 'b' });
  await act(async () => {});
  expect(isFavorited).toHaveBeenLastCalledWith('b', '1');
  setFavorited.mockClear();
  await act(async () => {
    resolve(true);
  });
  expect(setFavorited).not.toHaveBeenCalled();
});

it('收藏变更事件优先于初始读取的迟到结果', async () => {
  let resolve!: (value: boolean) => void;
  jest.mocked(isFavorited).mockImplementationOnce(
    () =>
      new Promise((settle) => {
        resolve = settle;
      }),
  );
  const setFavorited = jest.fn();
  renderHook(() => useFavoriteSync('a', '1', setFavorited));
  act(() => {
    window.dispatchEvent(new CustomEvent('favoritesUpdated', { detail: {} }));
  });
  await act(async () => {
    resolve(true);
  });
  expect(setFavorited).toHaveBeenCalledTimes(1);
  expect(setFavorited).toHaveBeenCalledWith(false);
});

import { act, renderHook } from '@testing-library/react';

import { usePlayFavorite } from '@/features/play/hooks/usePlayFavorite';
import { saveFavorite } from '@/lib/db.client';
import type { SearchResult } from '@/lib/types';

jest.mock('@/hooks/useFavoriteSync', () => ({ useFavoriteSync: jest.fn() }));
jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  saveFavorite: jest.fn(),
}));

it('收藏在途仅写一次，换源后旧结果不改新收藏态', async () => {
  let finish!: (key: string) => void;
  jest.mocked(saveFavorite).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const currentIdRef = { current: '1' };
  const setFavorited = jest.fn();
  const { result } = renderHook(() =>
    usePlayFavorite({
      currentSource: 'src',
      currentId: '1',
      searchTitle: '',
      videoTitleRef: { current: '作品' },
      detailRef: { current: { episodes: [] } as unknown as SearchResult },
      currentSourceRef: { current: 'src' },
      currentIdRef,
      favorited: false,
      setFavorited,
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleToggleFavorite();
  });
  await act(async () => result.current.handleToggleFavorite());
  expect(saveFavorite).toHaveBeenCalledTimes(1);
  currentIdRef.current = '2';
  await act(async () => {
    finish('src+1');
    await pending;
  });
  expect(setFavorited).not.toHaveBeenCalled();
});

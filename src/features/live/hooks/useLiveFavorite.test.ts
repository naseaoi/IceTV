import { act, renderHook } from '@testing-library/react';

import { useLiveFavorite } from '@/features/live/hooks/useLiveFavorite';
import type { LiveChannel, LiveSource } from '@/features/live/types';
import { saveFavorite } from '@/lib/db.client';

jest.mock('@/hooks/useFavoriteSync', () => ({ useFavoriteSync: jest.fn() }));
jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  saveFavorite: jest.fn(),
}));

it('直播收藏在途不重复写，失败后释放锁', async () => {
  let reject!: (error: Error) => void;
  jest
    .mocked(saveFavorite)
    .mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    )
    .mockResolvedValue('live_src+live_1');
  const source = { key: 'src', name: '源' } as LiveSource;
  const channel = { id: '1', name: '频道', logo: '' } as LiveChannel;
  const log = jest.spyOn(console, 'error').mockImplementation();
  const { result } = renderHook(() =>
    useLiveFavorite({
      currentSource: source,
      currentChannel: channel,
      currentSourceRef: { current: source },
      currentChannelRef: { current: channel },
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleToggleFavorite();
  });
  await act(async () => result.current.handleToggleFavorite());
  expect(saveFavorite).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('failed'));
    await pending;
  });
  expect(result.current.favorited).toBe(false);
  await act(async () => result.current.handleToggleFavorite());
  expect(saveFavorite).toHaveBeenCalledTimes(2);
  log.mockRestore();
});

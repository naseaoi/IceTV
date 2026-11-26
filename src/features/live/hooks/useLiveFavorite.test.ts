import { act, renderHook, waitFor } from '@testing-library/react';

import {
  groupLiveChannels,
  liveGroupFavoriteId,
} from '@/features/live/lib/liveChannelGroups';
import type { LiveChannel, LiveSource } from '@/features/live/types';
import { deleteFavorite, getAllFavorites, saveFavorite } from '@/lib/db.client';
import { showToast } from '@/lib/toast';

import { useLiveFavorite } from './useLiveFavorite';

jest.mock('@/lib/db.client', () => ({
  getAllFavorites: jest.fn().mockResolvedValue({}),
  generateStorageKey: (source: string, id: string) => source + '+' + id,
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
  deleteFavorite: jest.fn().mockResolvedValue(undefined),
  saveFavorite: jest.fn().mockResolvedValue('key'),
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));
const source = { key: 'src', name: '源' } as LiveSource;
const groups = groupLiveChannels([
  { id: 'src-0', lineId: 'line0', name: 'CCTV1高清', logo: '' } as LiveChannel,
  { id: 'src-1', lineId: 'line1', name: 'CCTV1', logo: '' } as LiveChannel,
]);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAllFavorites).mockResolvedValue({});
});

it('按频道组兼容旧索引收藏，取消时删除新旧全部键', async () => {
  const newId = liveGroupFavoriteId(groups[0].groupKey);
  const favorite = {
    title: 'CCTV1',
    source_name: '源',
    total_episodes: 1,
    year: '',
    cover: '',
    save_time: 1,
  };
  jest.mocked(getAllFavorites).mockResolvedValue({
    'live_src+live_src-0': favorite,
    'live_src+live_src-1': favorite,
    [`live_src+${newId}`]: favorite,
  });
  const { result, rerender } = renderHook(() =>
    useLiveFavorite({ currentSource: source, groups }),
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.isGroupFavorited(groups[0])).toBe(true);
  expect(result.current.favoriteGroups).toHaveLength(1);
  rerender();
  expect(getAllFavorites).toHaveBeenCalledTimes(1);
  await act(async () => result.current.toggleGroupFavorite(groups[0]));
  expect(deleteFavorite).toHaveBeenCalledTimes(3);
  expect(deleteFavorite).toHaveBeenCalledWith('live_src', newId);
  expect(deleteFavorite).toHaveBeenCalledWith('live_src', 'live_src-0');
  expect(result.current.isGroupFavorited(groups[0])).toBe(false);
});

it('新收藏使用稳定组 id，失败释放在途锁并保留未收藏状态', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(saveFavorite).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const { result } = renderHook(() =>
    useLiveFavorite({ currentSource: source, groups }),
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.toggleGroupFavorite(groups[0]);
  });
  await act(async () => result.current.toggleGroupFavorite(groups[0]));
  expect(saveFavorite).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('failed'));
    await pending;
  });
  expect(result.current.isGroupFavorited(groups[0])).toBe(false);
  expect(showToast).toHaveBeenCalledWith('收藏操作失败，请重试', 'error');
  await act(async () => result.current.toggleGroupFavorite(groups[0]));
  expect(saveFavorite).toHaveBeenLastCalledWith(
    'live_src',
    'live_group_cctv1',
    expect.objectContaining({ origin: 'live', title: 'CCTV1高清' }),
  );
  expect(result.current.isGroupFavorited(groups[0])).toBe(true);
});

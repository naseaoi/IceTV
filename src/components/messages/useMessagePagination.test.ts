import { act, renderHook } from '@testing-library/react';

import { setFavoriteTracking, setPlayRecordTracking } from '@/lib/db.client';
import type { TrackingUpdateUserMessage } from '@/lib/message-types';
import { showToast } from '@/lib/toast';

import { useMessagePagination } from './useMessagePagination';

jest.mock('@/lib/db.client', () => ({
  setFavoriteTracking: jest.fn(),
  setPlayRecordTracking: jest.fn(),
}));
jest.mock('@/lib/db.client.internal', () => ({
  triggerGlobalError: jest.fn(),
}));
jest.mock('@/lib/messages.client', () => ({
  getMessagePage: jest.fn(),
  readAllMessages: jest.fn(),
  readMessage: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

function trackingMessage(id: string): TrackingUpdateUserMessage {
  return {
    id,
    type: 'tracking-update',
    recordKey: 'src+vid',
    source: 'src',
    videoId: 'vid',
    title: '测试剧集',
    year: '2024',
    sourceName: '测试源站',
    cover: '',
    fromEpisodes: 1,
    toEpisodes: 2,
    createdAt: 1,
  };
}

function setup(message: TrackingUpdateUserMessage) {
  const onAfterMutate = jest.fn().mockResolvedValue(undefined);
  const hook = renderHook(() =>
    useMessagePagination({ previewModeRef: { current: null }, onAfterMutate }),
  );
  act(() =>
    hook.result.current.setPage({
      items: [message],
      total: 1,
      nextCursor: null,
    }),
  );
  return { hook, onAfterMutate };
}

beforeEach(() => jest.clearAllMocks());

it('播放记录追更消息关闭播放记录追更并移出列表', async () => {
  const message = trackingMessage('tracking:src%2Bvid:1:2');
  jest.mocked(setPlayRecordTracking).mockResolvedValue({} as never);
  const { hook, onAfterMutate } = setup(message);

  await act(async () => {
    await expect(hook.result.current.untrack(message)).resolves.toBe(true);
  });

  expect(setPlayRecordTracking).toHaveBeenCalledWith('src', 'vid', false);
  expect(setFavoriteTracking).not.toHaveBeenCalled();
  expect(hook.result.current.page).toEqual({
    items: [],
    total: 0,
    nextCursor: null,
  });
  expect(showToast).toHaveBeenCalledWith('已取消追更', 'success');
  expect(onAfterMutate).toHaveBeenCalledTimes(1);
});

it('收藏更新消息关闭收藏自身的追更', async () => {
  const message = trackingMessage('favorite-tracking:src%2Bvid:1:2');
  jest.mocked(setFavoriteTracking).mockResolvedValue({} as never);
  const { hook } = setup(message);

  await act(async () => {
    await hook.result.current.untrack(message);
  });

  expect(setFavoriteTracking).toHaveBeenCalledWith('src', 'vid', false);
  expect(setPlayRecordTracking).not.toHaveBeenCalled();
});

it('写入失败时保留消息并结束处理状态', async () => {
  const message = trackingMessage('tracking:src%2Bvid:1:2');
  jest.mocked(setPlayRecordTracking).mockRejectedValue(new Error('HTTP 500'));
  const { hook, onAfterMutate } = setup(message);

  await act(async () => {
    await expect(hook.result.current.untrack(message)).resolves.toBe(false);
  });

  expect(hook.result.current.page.items).toEqual([message]);
  expect(hook.result.current.workingIds.size).toBe(0);
  expect(showToast).not.toHaveBeenCalled();
  expect(onAfterMutate).not.toHaveBeenCalled();
});

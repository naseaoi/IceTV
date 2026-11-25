import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import ContinueWatching from '@/components/ContinueWatching';
import {
  getCachedPlayRecordsSnapshot,
  getPlayRecordPage,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import type { PlayRecord, PlayRecordPage } from '@/lib/types';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));
jest.mock('@/lib/db.client', () => ({
  getCachedPlayRecordsSnapshot: jest.fn(),
  getPlayRecordPage: jest.fn(),
  subscribeToDataUpdates: jest.fn(),
}));
jest.mock('@/lib/local-preferences', () => ({
  readContinueWatchingCount: () => 0,
  writeContinueWatchingCount: jest.fn(),
}));
jest.mock('@/components/ContinueCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));
jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// 消息摘要即使已清零，也不应覆盖播放记录的更新计数。
jest.mock('@/components/messages/MessageCenterProvider', () => ({
  useOptionalMessageCenter: () => ({ trackingUnreadCount: 0 }),
}));

const mockSnapshot = jest.mocked(getCachedPlayRecordsSnapshot);
const mockPage = jest.mocked(getPlayRecordPage);
const mockSubscribe = jest.mocked(subscribeToDataUpdates);
const updated: PlayRecord = {
  title: '作品',
  source_name: '源站',
  cover: '',
  year: '2026',
  index: 5,
  total_episodes: 9,
  update_baseline_episodes: 8,
  play_time: 120,
  total_time: 1800,
  save_time: 300,
};
const records: Record<string, PlayRecord> = { 's+1': updated };
const listeners = new Map<
  string,
  Set<(data: Record<string, PlayRecord>) => void>
>();

function emit(event: string, data = records) {
  act(() => {
    listeners.get(event)?.forEach((listener) => listener(data));
  });
}

async function flushCount() {
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.clear();
  mockSnapshot.mockReturnValue(null);
  mockPage.mockResolvedValue({ items: records, total: 1, nextCursor: null });
  mockSubscribe.mockImplementation((event, callback) => {
    const callbacks = listeners.get(event) ?? new Set();
    callbacks.add(callback);
    listeners.set(event, callbacks);
    return () => {
      callbacks.delete(callback);
    };
  });
});
afterEach(() => {
  jest.useRealTimers();
});

it('刚查询的服务端种子省去重复请求，后续状态事件仍更新计数', async () => {
  render(
    <ContinueWatching
      initialRecords={records}
      initialUpdateCount={1}
      initialFetchedAt={Date.now()}
    />,
  );
  await flushCount();
  expect(mockPage).not.toHaveBeenCalled();
  emit('playRecordStatesUpdated');
  await flushCount();
  expect(mockPage).toHaveBeenCalledTimes(1);
});

it('预取或后退恢复的旧种子重新查询记录与计数', async () => {
  render(
    <ContinueWatching
      initialRecords={records}
      initialUpdateCount={1}
      initialFetchedAt={Date.now() - 60_000}
    />,
  );
  await flushCount();
  expect(mockPage).toHaveBeenCalledTimes(2);
});

it('服务端种子保留首页更新数，不采用已清零的消息摘要', () => {
  render(
    <ContinueWatching
      initialRecords={records}
      initialUpdateCount={1}
      refreshOnMount={false}
    />,
  );
  expect(screen.getByRole('link', { name: '1 部有更新' })).toHaveAttribute(
    'href',
    '/continue-watching?filter=updated',
  );
  expect(mockPage).not.toHaveBeenCalled();
});

it('完整快照覆盖种子：消息已读保留计数，卡片已读与取消追更减少计数', async () => {
  mockSnapshot.mockReturnValue({ ...records, 's+2': updated });
  render(<ContinueWatching initialRecords={records} initialUpdateCount={5} />);
  await flushCount();
  expect(screen.getByRole('link', { name: '2 部有更新' })).toBeInTheDocument();

  const read = { ...updated, update_message_read_episodes: 9 };
  mockSnapshot.mockReturnValue({ 's+1': read, 's+2': updated });
  emit('playRecordStatesUpdated', { 's+1': read });
  act(() => {
    window.dispatchEvent(new CustomEvent('messagesUpdated'));
  });
  expect(screen.getByRole('link', { name: '2 部有更新' })).toBeInTheDocument();

  const acknowledged = { ...read, update_baseline_episodes: 9 };
  mockSnapshot.mockReturnValue({ 's+1': acknowledged, 's+2': updated });
  emit('playRecordsUpdated', { 's+1': acknowledged, 's+2': updated });
  expect(screen.getByRole('link', { name: '1 部有更新' })).toBeInTheDocument();

  mockSnapshot.mockReturnValue({
    's+1': acknowledged,
    's+2': { ...updated, tracking_enabled: false },
  });
  emit('playRecordStatesUpdated', {
    's+2': { ...updated, tracking_enabled: false },
  });
  expect(screen.getByRole('link', { name: '更多' })).toHaveAttribute(
    'href',
    '/continue-watching',
  );
  expect(
    mockPage.mock.calls.filter(
      ([, , options]) => options?.filter === 'updated',
    ),
  ).toHaveLength(0);
});

it('无完整快照时按筛选总数计数，合并重复事件且不把 recent 局部记录当总数', async () => {
  let total = 3;
  mockPage.mockImplementation(async (_limit, _cursor, options) => ({
    items: records,
    total: options?.filter === 'updated' ? total : 10,
    nextCursor: null,
  }));
  render(<ContinueWatching initialRecords={records} initialUpdateCount={3} />);
  await flushCount();
  expect(screen.getByRole('link', { name: '3 部有更新' })).toBeInTheDocument();
  mockPage.mockClear();

  emit('playRecordStatesUpdated', {
    's+1': { ...updated, update_message_read_episodes: 9 },
  });
  emit('recentPlayRecordsUpdated');
  emit('playRecordStatesUpdated');
  await flushCount();
  expect(mockPage).toHaveBeenCalledTimes(1);
  expect(mockPage).toHaveBeenCalledWith(1, null, {
    filter: 'updated',
    signal: expect.any(AbortSignal),
  });
  expect(screen.getByRole('link', { name: '3 部有更新' })).toBeInTheDocument();

  total = 2;
  emit('playRecordStatesUpdated', {
    's+1': { ...updated, update_baseline_episodes: 9 },
  });
  await flushCount();
  expect(screen.getByRole('link', { name: '2 部有更新' })).toBeInTheDocument();
  mockPage.mockClear();
  act(() => {
    window.dispatchEvent(new CustomEvent('messagesUpdated'));
  });
  await flushCount();
  expect(mockPage).not.toHaveBeenCalled();
});

it('新状态使在途计数作废，卸载取消在途请求和事件订阅', async () => {
  const pending: {
    signal: AbortSignal;
    resolve: (page: PlayRecordPage) => void;
  }[] = [];
  mockPage.mockImplementation((_limit, _cursor, options) => {
    if (!options?.filter)
      return Promise.resolve({ items: records, total: 1, nextCursor: null });
    return new Promise((resolve) => {
      pending.push({ signal: options.signal!, resolve });
    });
  });
  const { unmount } = render(
    <ContinueWatching initialRecords={records} initialUpdateCount={1} />,
  );
  await flushCount();
  emit('playRecordStatesUpdated');
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => {
    pending[0].resolve({ items: {}, total: 99, nextCursor: null });
  });
  expect(screen.getByRole('link', { name: '1 部有更新' })).toBeInTheDocument();
  await flushCount();
  unmount();
  expect(pending[1].signal.aborted).toBe(true);
  expect(
    [...listeners.values()].every((callbacks) => callbacks.size === 0),
  ).toBe(true);
});

it('卸载清除尚未执行的计数防抖任务', async () => {
  const { unmount } = render(
    <ContinueWatching initialRecords={records} initialUpdateCount={1} />,
  );
  unmount();
  await flushCount();
  expect(
    mockPage.mock.calls.filter(
      ([, , options]) => options?.filter === 'updated',
    ),
  ).toHaveLength(0);
});

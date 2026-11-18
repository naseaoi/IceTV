import { readDetailSnapshot } from '@/features/play/lib/detailSnapshot';
import {
  clearPlaybackWarmups,
  fetchSharedPlaybackDetail,
  getSharedPlaybackDetail,
  getSharedPlaybackSearch,
  warmupForPlayback,
  warmupSearchForTitle,
} from '@/lib/video-prefetch';

const detail = {
  source: 'a',
  id: '1',
  title: '测试',
  episodes: ['https://a/1.m3u8'],
};
beforeEach(() => {
  jest.useFakeTimers();
  clearPlaybackWarmups();
  sessionStorage.clear();
  localStorage.clear();
  document.cookie = `auth_meta=${encodeURIComponent(JSON.stringify({ username: 'warmup' }))}`;
});
afterEach(() => {
  jest.useRealTimers();
});

it('在途与完成详情共享一次请求，成功写快照，过期重新请求', async () => {
  let finish!: (value: unknown) => void;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  ) as unknown as typeof fetch;
  warmupForPlayback('a', '1');
  const task = fetchSharedPlaybackDetail('a', '1');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  finish({ ok: true, json: async () => detail });
  await expect(task).resolves.toEqual(detail);
  expect(readDetailSnapshot('a', '1')).toEqual(detail);
  expect(getSharedPlaybackDetail('a', '1')).toBe(task);
  jest.advanceTimersByTime(30_001);
  expect(getSharedPlaybackDetail('a', '1')).toBeNull();
});

it('HTTP 失败不缓存，后续请求可以重试', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => detail });
  await expect(fetchSharedPlaybackDetail('a', '1')).rejects.toThrow();
  expect(getSharedPlaybackDetail('a', '1')).toBeNull();
  await expect(fetchSharedPlaybackDetail('a', '1')).resolves.toEqual(detail);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('完整搜索复用在途预热并保留失败源统计', async () => {
  let finish!: (value: unknown) => void;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  ) as unknown as typeof fetch;
  warmupSearchForTitle('测试');
  const task = getSharedPlaybackSearch('测试');
  expect(task).not.toBeNull();
  const data = { results: [detail], totalSources: 2, failedSources: ['b'] };
  finish({ ok: true, json: async () => data });
  await expect(task).resolves.toEqual(data);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

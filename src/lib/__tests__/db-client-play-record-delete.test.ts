import {
  clearAllPlayRecords,
  deletePlayRecord,
  deletePlayRecords,
  savePlayRecord,
} from '@/lib/db.client';
import { cacheManager } from '@/lib/db.client.cache';
import type { PlayRecord } from '@/lib/types';

jest.mock('@/lib/auth.client', () => ({
  AUTH_SESSION_LOST_EVENT: 'auth:lost',
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

const originalFetch = global.fetch;
const record = {
  title: '作品',
  source_name: '源',
  index: 1,
  save_time: 1,
} as PlayRecord;
const ok = { ok: true, json: async () => ({}) };

function deferredResponse() {
  let resolve!: () => void;
  const response = new Promise((settle) => {
    resolve = () => settle(ok);
  });
  return { resolve, response };
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function deleteCalls(fetchMock: jest.Mock) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
  );
}

beforeEach(() => {
  localStorage.clear();
  window.dispatchEvent(new Event('auth:lost'));
  cacheManager.cachePlayRecords({ 's+1': record, 's+2': record });
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

describe('删除播放记录等待本标签页的进度保存', () => {
  it('同键保存在重试中时，删除等保存结束后再发出', async () => {
    jest.useFakeTimers();
    const retried = deferredResponse();
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockReturnValueOnce(retried.response)
      .mockResolvedValue(ok);
    global.fetch = fetchMock;

    const save = savePlayRecord('s', '1', record);
    const removal = deletePlayRecord('s', '1');
    await flush();
    jest.advanceTimersByTime(600);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deleteCalls(fetchMock)).toHaveLength(0);
    expect(cacheManager.getCachedPlayRecords()?.['s+1']).toBeUndefined();

    retried.resolve();
    await save;
    await removal;
    expect(deleteCalls(fetchMock)).toHaveLength(1);
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: 'DELETE',
    });
  });

  it('其他键的在途保存不阻塞批量删除', async () => {
    const pending = deferredResponse();
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(pending.response)
      .mockResolvedValue(ok);
    global.fetch = fetchMock;

    const save = savePlayRecord('s', '2', record);
    await deletePlayRecords(['s+1']);

    expect(deleteCalls(fetchMock)).toHaveLength(1);
    pending.resolve();
    await save;
  });

  it('清空全部等待所有键的在途保存', async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(first.response)
      .mockReturnValueOnce(second.response)
      .mockResolvedValue(ok);
    global.fetch = fetchMock;

    const saves = [
      savePlayRecord('s', '1', record),
      savePlayRecord('s', '2', record),
    ];
    const removal = clearAllPlayRecords();
    first.resolve();
    await flush();
    expect(deleteCalls(fetchMock)).toHaveLength(0);

    second.resolve();
    await Promise.all([...saves, removal]);
    expect(deleteCalls(fetchMock)).toHaveLength(1);
  });

  it('保存长时间未结束时，超时后照常删除', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue(ok);
    global.fetch = fetchMock;

    void savePlayRecord('s', '1', record);
    const removal = deletePlayRecord('s', '1');
    await flush();
    jest.advanceTimersByTime(4999);
    await flush();
    expect(deleteCalls(fetchMock)).toHaveLength(0);

    jest.advanceTimersByTime(1);
    await removal;
    expect(deleteCalls(fetchMock)).toHaveLength(1);
  });
});

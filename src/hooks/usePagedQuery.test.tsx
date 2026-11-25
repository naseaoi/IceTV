import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';

import { usePagedQuery } from './usePagedQuery';

type Page = {
  items: { id: string }[];
  nextCursor: string | null;
  total: number;
};
const page = (ids: string[], nextCursor: string | null = null): Page => ({
  items: ids.map((id) => ({ id })),
  nextCursor,
  total: 100,
});

function setup() {
  const requests: {
    queryKey: string;
    cursor: string | undefined;
    signal: AbortSignal;
    resolve: (value: Page) => void;
    reject: (error: Error) => void;
  }[] = [];
  const fetchPage = jest.fn(
    (queryKey: string, cursor: string | undefined, signal: AbortSignal) =>
      new Promise<Page>((resolve, reject) => {
        requests.push({ queryKey, cursor, signal, resolve, reject });
      }),
  );
  const renders: ReturnType<typeof usePagedQuery<Page>>[] = [];
  const hook = renderHook(
    ({ scopeKey, queryKey, enabled }) => {
      const result = usePagedQuery({
        scopeKey,
        queryKey,
        enabled,
        fetchPage: (cursor, signal) => fetchPage(queryKey, cursor, signal),
        getItemKey: (item) => item.id,
      });
      renders.push(result);
      return result;
    },
    { initialProps: { scopeKey: 'user', queryKey: 'a', enabled: true } },
  );
  const switchQuery = (queryKey: string) =>
    hook.rerender({ scopeKey: 'user', queryKey, enabled: true });
  const resolve = async (index: number, value: Page) => {
    await act(async () => requests[index].resolve(value));
  };
  const reject = async (index: number) => {
    await act(async () => requests[index].reject(new Error('network failure')));
  };
  return {
    ...hook,
    requests,
    renders,
    fetchPage,
    switchQuery,
    resolve,
    reject,
  };
}

it('查询变化的首帧保留旧结果并立即进入刷新，切回时首帧显示快照', async () => {
  const { renders, switchQuery, resolve } = setup();
  await resolve(0, page(['a']));
  renders.length = 0;
  switchQuery('b');
  expect(renders[0]).toMatchObject({
    data: page(['a']),
    currentData: null,
    isPlaceholderData: true,
    refreshing: true,
    initialLoading: false,
    loadingMore: false,
  });
  await resolve(1, page(['b']));
  renders.length = 0;
  switchQuery('a');
  expect(renders[0]).toMatchObject({
    data: page(['a']),
    currentData: page(['a']),
    isPlaceholderData: false,
    refreshing: true,
  });
});

it('scope 变化的首帧隔离旧数据并立即进入首次加载', async () => {
  const { renders, rerender, resolve } = setup();
  await resolve(0, page(['private']));
  renders.length = 0;
  rerender({ scopeKey: 'other-user', queryKey: 'a', enabled: true });
  expect(renders[0]).toMatchObject({
    data: null,
    currentData: null,
    initialLoading: true,
    refreshing: false,
    error: null,
  });
});

it('新查询首帧忽略旧错误，保留同 scope 的展示数据', async () => {
  const { renders, switchQuery, resolve, reject } = setup();
  await resolve(0, page(['a']));
  switchQuery('b');
  await reject(1);
  renders.length = 0;
  switchQuery('c');
  expect(renders[0]).toMatchObject({
    data: page(['a']),
    currentData: null,
    refreshing: true,
    error: null,
    errorPhase: null,
  });
});

it('停用时保留展示数据且没有请求加载态，重新启用首帧立即刷新', async () => {
  const { renders, requests, rerender, resolve } = setup();
  await resolve(0, page(['a']));
  renders.length = 0;
  rerender({ scopeKey: 'user', queryKey: 'b', enabled: false });
  expect(renders[0]).toMatchObject({
    data: page(['a']),
    currentData: null,
    initialLoading: false,
    refreshing: false,
    loadingMore: false,
  });
  expect(requests).toHaveLength(1);
  renders.length = 0;
  rerender({ scopeKey: 'user', queryKey: 'b', enabled: true });
  expect(renders[0].refreshing).toBe(true);
  expect(requests).toHaveLength(2);
});

it('rapid query switches abort old requests and only apply the latest response', async () => {
  const { result, requests, switchQuery, resolve } = setup();
  expect(result.current.initialLoading).toBe(true);
  switchQuery('b');
  switchQuery('c');
  expect(requests.map(({ signal }) => signal.aborted)).toEqual([
    true,
    true,
    false,
  ]);
  await resolve(2, page(['c']));
  await resolve(0, page(['a']));
  await resolve(1, page(['b']));
  expect(result.current.data?.items).toEqual([{ id: 'c' }]);
  expect(result.current.initialLoading).toBe(false);
});

it('shows a first-page snapshot on switch-back and still revalidates', async () => {
  const { result, requests, switchQuery, resolve } = setup();
  await resolve(0, page(['a'], 'next'));
  act(() => result.current.loadMore());
  await resolve(1, page(['extra']));
  switchQuery('b');
  expect(result.current.data?.items).toHaveLength(2);
  expect(result.current.refreshing).toBe(true);
  await resolve(2, page(['b']));
  switchQuery('a');
  expect(result.current.data?.items).toEqual([{ id: 'a' }]);
  expect(result.current.refreshing).toBe(true);
  expect(requests[3].queryKey).toBe('a');
  await resolve(3, page(['fresh-a']));
  expect(result.current.data?.items).toEqual([{ id: 'fresh-a' }]);
});

it('refresh clears all snapshots before refetching the first page', async () => {
  const { result, requests, switchQuery, resolve } = setup();
  await resolve(0, page(['a']));
  switchQuery('b');
  await resolve(1, page(['b']));
  act(() => result.current.refresh());
  expect(requests[2].cursor).toBeUndefined();
  await resolve(2, page(['fresh-b']));
  switchQuery('a');
  expect(result.current.data?.items).toEqual([{ id: 'fresh-b' }]);
});

it('refresh aborts loadMore and discards its late response', async () => {
  const { result, requests, resolve } = setup();
  await resolve(0, page(['a'], 'next'));
  act(() => {
    result.current.loadMore();
    result.current.loadMore();
  });
  expect(requests).toHaveLength(2);
  expect(result.current.loadingMore).toBe(true);
  act(() => result.current.refresh());
  expect(requests[1].signal.aborted).toBe(true);
  expect(result.current.loadingMore).toBe(false);
  expect(result.current.refreshing).toBe(true);
  await resolve(1, page(['stale-more']));
  expect(result.current.refreshing).toBe(true);
  await resolve(2, page(['fresh']));
  expect(result.current.data?.items).toEqual([{ id: 'fresh' }]);
});

it('updateData during a first-page request mutates immediately and reissues it', async () => {
  const { result, requests, resolve } = setup();
  act(() => result.current.updateData(() => page(['saved'])));
  expect(result.current.data?.items).toEqual([{ id: 'saved' }]);
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests).toHaveLength(2);
  await resolve(0, page(['stale']));
  expect(result.current.data?.items).toEqual([{ id: 'saved' }]);
  await resolve(1, page(['server-saved']));
  expect(result.current.data?.items).toEqual([{ id: 'server-saved' }]);
});

it('idle updateData composes synchronous mutations without refetch and clears snapshots', async () => {
  const { result, requests, switchQuery, resolve } = setup();
  await resolve(0, page(['a']));
  switchQuery('b');
  await resolve(1, page(['b', 'c']));
  act(() => {
    result.current.updateData((current) => current && { ...current, total: 2 });
    result.current.updateData(
      (current) => current && { ...current, total: current.total + 1 },
    );
  });
  expect(result.current.data?.total).toBe(3);
  expect(requests).toHaveLength(2);
  switchQuery('a');
  expect(result.current.data?.items).toEqual([{ id: 'b' }, { id: 'c' }]);
});

it('updateData during loadMore restarts the first page instead of appending stale data', async () => {
  const { result, requests, resolve } = setup();
  await resolve(0, page(['a'], 'next'));
  act(() => result.current.loadMore());
  act(() => result.current.updateData(() => page(['saved'])));
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests[2].cursor).toBeUndefined();
  await resolve(1, page(['stale']));
  expect(result.current.data?.items).toEqual([{ id: 'saved' }]);
  await resolve(2, page(['saved', 'server']));
  expect(result.current.data?.items).toHaveLength(2);
});

it('scope changes reset data to null, abort requests and clear snapshots', async () => {
  const { result, requests, rerender, switchQuery, resolve } = setup();
  await resolve(0, page(['private-a']));
  switchQuery('b');
  rerender({ scopeKey: 'other-user', queryKey: 'a', enabled: true });
  expect(result.current.data).toBeNull();
  expect(result.current.initialLoading).toBe(true);
  expect(requests[1].signal.aborted).toBe(true);
  await resolve(1, page(['private-b']));
  expect(result.current.data).toBeNull();
  await resolve(2, page(['other-user']));
  expect(result.current.data?.items).toEqual([{ id: 'other-user' }]);
});

it('first-page failures keep displayed data and discard that query snapshot', async () => {
  const { result, switchQuery, resolve, reject } = setup();
  await resolve(0, page(['a']));
  switchQuery('b');
  await resolve(1, page(['b']));
  switchQuery('a');
  await reject(2);
  expect(result.current.data?.items).toEqual([{ id: 'a' }]);
  expect(result.current.error).toEqual(new Error('network failure'));
  expect(result.current.refreshing).toBe(false);
  switchQuery('b');
  await resolve(3, page(['fresh-b']));
  switchQuery('a');
  expect(result.current.data?.items).toEqual([{ id: 'fresh-b' }]);
  expect(result.current.error).toBeNull();
});

it('loadMore deduplicates against previous items and within the incoming page', async () => {
  const { result, requests, resolve } = setup();
  act(() => result.current.loadMore());
  expect(requests).toHaveLength(1);
  await resolve(0, page(['a'], 'next'));
  act(() => result.current.loadMore());
  await resolve(1, page(['a', 'b', 'b', 'c']));
  expect(result.current.data?.items).toEqual([
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ]);
  act(() => result.current.loadMore());
  expect(requests).toHaveLength(2);
});

it('loadMore failure keeps data and can be retried', async () => {
  const { result, resolve, reject } = setup();
  await resolve(0, page(['a'], 'next'));
  act(() => result.current.loadMore());
  await reject(1);
  expect(result.current.data?.items).toEqual([{ id: 'a' }]);
  expect(result.current.loadingMore).toBe(false);
  expect(result.current.error).not.toBeNull();
  act(() => result.current.retry());
  await resolve(2, page(['b']));
  expect(result.current.data?.items).toHaveLength(2);
  expect(result.current.error).toBeNull();
});

it('disabling aborts in-flight work and defers refresh until enabled', async () => {
  const { result, requests, rerender, resolve } = setup();
  rerender({ scopeKey: 'user', queryKey: 'a', enabled: false });
  expect(requests[0].signal.aborted).toBe(true);
  act(() => result.current.refresh());
  expect(requests).toHaveLength(1);
  await resolve(0, page(['stale']));
  expect(result.current.data).toBeNull();
  rerender({ scopeKey: 'user', queryKey: 'a', enabled: true });
  expect(requests).toHaveLength(2);
  await resolve(1, page(['fresh']));
  expect(result.current.data?.items).toEqual([{ id: 'fresh' }]);
});

it('bounds snapshots to the twenty most recently stored first pages', async () => {
  const { result, switchQuery, resolve } = setup();
  await resolve(0, page(['a']));
  for (let index = 1; index <= 20; index += 1) {
    switchQuery(String(index));
    await resolve(index, page([String(index)]));
  }
  switchQuery('a');
  expect(result.current.data?.items).toEqual([{ id: '20' }]);
  switchQuery('1');
  expect(result.current.data?.items).toEqual([{ id: '1' }]);
});

it('unmount aborts requests and new instances start without snapshots', async () => {
  const first = setup();
  await first.resolve(0, page(['a']));
  act(() => first.result.current.refresh());
  first.unmount();
  expect(first.requests[1].signal.aborted).toBe(true);
  await first.resolve(1, page(['late']));
  const second = setup();
  expect(second.result.current.data).toBeNull();
  second.unmount();
  expect(second.requests[0].signal.aborted).toBe(true);
});

it('survives StrictMode effect cleanup and setup', async () => {
  const signals: AbortSignal[] = [];
  const { result } = renderHook(
    () =>
      usePagedQuery({
        scopeKey: 'user',
        queryKey: 'a',
        fetchPage: async (_cursor, signal) => {
          signals.push(signal);
          return page(['a']);
        },
        getItemKey: (item) => item.id,
      }),
    { wrapper: StrictMode },
  );
  await act(async () => undefined);
  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(result.current.data?.items).toEqual([{ id: 'a' }]);
});

it('隔离 A 占位数据，B 首页失败后只重试 B 首页', async () => {
  const { result, requests, switchQuery, resolve, reject } = setup();
  await resolve(0, page(['a'], 'a-next'));
  switchQuery('b');
  expect(result.current.isPlaceholderData).toBe(true);
  expect(result.current.currentData).toBeNull();
  const updater = jest.fn(() => page(['wrong']));
  act(() => {
    result.current.loadMore();
    result.current.updateData(updater);
  });
  expect(updater).not.toHaveBeenCalled();
  expect(requests).toHaveLength(2);
  await reject(1);
  expect(result.current.errorPhase).toBe('first');
  expect(result.current.data).toBeNull();
  expect(result.current.currentData).toBeNull();
  act(() => result.current.loadMore());
  expect(requests).toHaveLength(2);
  act(() => result.current.retry());
  expect(requests[2]).toMatchObject({ queryKey: 'b', cursor: undefined });
  await resolve(2, page(['b'], 'b-next'));
  expect(result.current.currentData?.items).toEqual([{ id: 'b' }]);
  act(() => result.current.loadMore());
  expect(requests[3]).toMatchObject({ queryKey: 'b', cursor: 'b-next' });
  await reject(3);
  expect(result.current.errorPhase).toBe('more');
  act(() => result.current.retry());
  expect(requests[4]).toMatchObject({ queryKey: 'b', cursor: 'b-next' });
});

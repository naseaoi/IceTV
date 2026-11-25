import { act, renderHook } from '@testing-library/react';

import { useProfilePage } from './useProfilePage';

it('筛选首页失败后清除旧占位，重试首页而不是旧条件续页', async () => {
  const loadA = jest
    .fn()
    .mockResolvedValue({ items: ['a'], nextCursor: 'a-next' });
  const loadB = jest
    .fn()
    .mockRejectedValueOnce(new Error('加载失败'))
    .mockResolvedValue({ items: ['b'], nextCursor: 'b-next' });
  const { result, rerender } = renderHook(
    ({ load }) => useProfilePage<string>(load, { keepItems: true }),
    { initialProps: { load: loadA } },
  );
  await act(async () => {});
  expect(result.current.items).toEqual(['a']);
  rerender({ load: loadB });
  await act(async () => {});
  expect(result.current.items).toEqual([]);
  expect(result.current.cursor).toBeNull();
  expect(result.current.errorPhase).toBe('first');
  await act(async () => result.current.loadMore());
  expect(loadB).toHaveBeenCalledTimes(1);
  await act(async () => result.current.retry());
  expect(loadB).toHaveBeenLastCalledWith(null);
  expect(result.current.items).toEqual(['b']);
  await act(async () => result.current.loadMore());
  expect(loadB).toHaveBeenLastCalledWith('b-next');
});

it('续页失败保留当前条件结果并重试相同游标', async () => {
  const load = jest
    .fn()
    .mockResolvedValueOnce({ items: ['a'], nextCursor: 'next' })
    .mockRejectedValueOnce(new Error('加载失败'))
    .mockResolvedValue({ items: ['b'], nextCursor: null });
  const { result } = renderHook(() => useProfilePage<string>(load));
  await act(async () => {});
  await act(async () => result.current.loadMore());
  expect(result.current.errorPhase).toBe('more');
  expect(result.current.items).toEqual(['a']);
  await act(async () => result.current.retry());
  expect(load).toHaveBeenLastCalledWith('next');
  expect(result.current.items).toEqual(['a', 'b']);
});

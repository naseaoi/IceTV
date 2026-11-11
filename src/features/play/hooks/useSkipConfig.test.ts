import { act, renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';

import {
  deleteSkipConfig,
  getSkipConfig,
  saveSkipConfig,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';

import { useSkipConfig } from './useSkipConfig';

jest.mock('@/lib/db.client', () => ({
  deleteSkipConfig: jest.fn(),
  getSkipConfig: jest.fn(),
  saveSkipConfig: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
const initial = { enable: false, intro_time: 0, outro_time: 0 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSkipConfig).mockResolvedValue(initial);
});

it('同键提交串行，前次失败不撤销最新操作，最新失败回到最后确认值', async () => {
  let rejectFirst!: (error: Error) => void;
  jest
    .mocked(saveSkipConfig)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new TypeError('offline'));
  const skipConfigRef = { current: initial };
  const setSkipConfig = jest.fn();
  const { result } = renderHook(() =>
    useSkipConfig({
      currentSource: 's',
      currentId: '1',
      currentSourceRef: { current: 's' },
      currentIdRef: { current: '1' },
      skipConfigRef,
      artPlayerRef: { current: null as Artplayer | null },
      setSkipConfig,
    }),
  );
  await act(async () => {});
  expect(getSkipConfig).toHaveBeenCalledWith('s', '1');
  const first = { ...initial, intro_time: 10 };
  const second = { ...initial, intro_time: 20 };
  let pending!: Promise<void>;
  await act(async () => {
    void result.current.handleSkipConfigChange(first);
    pending = result.current.handleSkipConfigChange(second);
    await Promise.resolve();
  });
  expect(saveSkipConfig).toHaveBeenCalledTimes(1);
  expect(skipConfigRef.current).toEqual(second);
  await act(async () => {
    rejectFirst(new Error('failed'));
    await pending;
  });
  expect(saveSkipConfig).toHaveBeenCalledTimes(2);
  expect(skipConfigRef.current).toEqual(second);
  await act(async () => {
    await result.current.handleSkipConfigChange({ ...initial, intro_time: 30 });
  });
  expect(skipConfigRef.current).toEqual(second);
  expect(showToast).toHaveBeenCalledTimes(2);
  expect(deleteSkipConfig).not.toHaveBeenCalled();
});

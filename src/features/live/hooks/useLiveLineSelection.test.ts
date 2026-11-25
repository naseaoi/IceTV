import { act, renderHook } from '@testing-library/react';

import { groupLiveChannels } from '@/features/live/lib/liveChannelGroups';
import type { LiveChannel, LiveSource } from '@/features/live/types';
import { removeStorage } from '@/lib/browser-storage';
import {
  LIVE_LINE_RESULTS_STORAGE_KEY,
  readLiveLineResults,
} from '@/lib/live-line-results';
import { readLastLiveChannel } from '@/lib/local-preferences';
import { showToast } from '@/lib/toast';

import { useLiveLineSelection } from './useLiveLineSelection';

jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));
const source = { key: 'src' } as LiveSource;
const lines = [1, 2, 3].map((index) => ({
  id: `src-${index}`,
  lineId: `line${index}`,
  name: 'CCTV1',
  url: `${index}`,
  group: '央视',
  logo: '',
  tvgId: '1',
}));
const groups = groupLiveChannels(lines);
beforeEach(() => {
  removeStorage(LIVE_LINE_RESULTS_STORAGE_KEY);
  jest.clearAllMocks();
});

it('最终失败按排序依次切换，每次意图只尝试一次，耗尽后等待重试', () => {
  const onChange = jest.fn();
  const { result, rerender } = renderHook(
    ({ currentChannel }: { currentChannel: LiveChannel }) =>
      useLiveLineSelection({
        currentChannel,
        currentSource: source,
        groups,
        onChange,
      }),
    { initialProps: { currentChannel: lines[0] } },
  );
  act(() => {
    result.current.onFailure(lines[0], source.key);
    result.current.onFailure(lines[0], source.key);
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(lines[1]);
  expect(showToast).toHaveBeenCalledWith(
    '线路 1 无法播放，已切换到线路 2',
    'notice',
    expect.anything(),
  );
  rerender({ currentChannel: lines[1] });
  act(() => result.current.onFailure(lines[1], source.key));
  expect(onChange).toHaveBeenLastCalledWith(lines[2]);
  rerender({ currentChannel: lines[2] });
  act(() => result.current.onFailure(lines[2], source.key));
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(result.current.nextLine).toBeUndefined();
  act(() => result.current.retry(jest.fn()));
  expect(onChange).toHaveBeenLastCalledWith(lines[0]);
});

it('首帧记忆与手选线路保留，旧频道回调不改变当前播放', () => {
  const onChange = jest.fn();
  const other = { ...lines[0], id: 'other', lineId: 'other', name: 'CCTV2' };
  const allGroups = groupLiveChannels([...lines, other]);
  const { result, rerender } = renderHook(
    ({ currentChannel }: { currentChannel: LiveChannel }) =>
      useLiveLineSelection({
        currentChannel,
        currentSource: source,
        groups: allGroups,
        onChange,
      }),
    { initialProps: { currentChannel: lines[0] } },
  );
  act(() => result.current.selectLine(lines[2]));
  rerender({ currentChannel: lines[2] });
  act(() => result.current.onFirstFrame(lines[2], source.key));
  expect(readLiveLineResults().get('line3')?.ok).toBe(true);
  expect(readLastLiveChannel()).toEqual({
    sourceKey: 'src',
    groupKey: 'cctv1',
  });
  rerender({ currentChannel: other });
  onChange.mockClear();
  act(() => result.current.onFailure(lines[2], source.key));
  expect(onChange).not.toHaveBeenCalled();
  act(() => result.current.selectGroup(allGroups[0]));
  expect(onChange).toHaveBeenLastCalledWith(lines[2]);
});

it('等待时主动换线保持尝试集合，慢连接不写失败', () => {
  const onChange = jest.fn();
  const { result, rerender } = renderHook(
    ({ currentChannel }: { currentChannel: LiveChannel }) =>
      useLiveLineSelection({
        currentChannel,
        currentSource: source,
        groups,
        onChange,
      }),
    { initialProps: { currentChannel: lines[0] } },
  );
  act(() => result.current.switchNext());
  expect(onChange).toHaveBeenLastCalledWith(lines[1]);
  rerender({ currentChannel: lines[1] });
  expect(result.current.nextLine).toEqual(lines[2]);
  expect(readLiveLineResults().size).toBe(0);
});

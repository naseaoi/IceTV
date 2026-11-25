import type { LiveChannel } from '@/features/live/types';
import { LIVE_LINE_RESULT_TTL_MS } from '@/lib/live-line-results';

import {
  groupLiveChannels,
  matchesLiveChannel,
  sortLiveLines,
} from './liveChannelGroups';

const line = (id: string, name: string, status?: LiveChannel['health']) => ({
  id,
  lineId: id,
  name,
  logo: id,
  group: id,
  tvgId: id,
  url: id,
  health: status,
});

it('归一频道名称，保留第一条展示信息与订阅线路编号，CCTV5+ 独立成组', () => {
  const channels = [
    line('a', 'CCTV5 高清'),
    line('b', 'CCTV5+'),
    line('c', 'cctv5 HD'),
    line('d', '高清'),
  ];
  const groups = groupLiveChannels(channels);
  expect(groups).toHaveLength(3);
  expect(groups[0]).toMatchObject({
    name: 'CCTV5 高清',
    logo: 'a',
    group: 'a',
    groupKey: 'cctv5',
    lines: [channels[0], channels[2]],
  });
  expect(groups[2].groupKey).toBe('高清');
  expect(matchesLiveChannel(groups[0], 'CCTV5 HD')).toBe(true);
  expect(matchesLiveChannel(groups[1], '5+')).toBe(true);
  expect(matchesLiveChannel(groups[1], '不存在')).toBe(false);
});

it('本机成功、服务器可用延迟、slow、unknown、本机失败/failed、ended 顺序稳定', () => {
  const now = 10_000_000;
  const channels = [
    line('ended', 'x', { status: 'ended' }),
    line('failed', 'x', { status: 'failed' }),
    line('unknown', 'x'),
    line('slow', 'x', { status: 'slow' }),
    line('ok2', 'x', { status: 'ok', latencyMs: 200 }),
    line('ok1', 'x', { status: 'ok', latencyMs: 100 }),
    line('localFailed', 'x', { status: 'ok', latencyMs: 1 }),
    line('localOk', 'x', { status: 'failed' }),
  ];
  const local = new Map([
    ['localFailed', { ok: false, at: now }],
    ['localOk', { ok: true, at: now }],
  ]);
  expect(sortLiveLines(channels, local, now).map((item) => item.id)).toEqual([
    'localOk',
    'ok1',
    'ok2',
    'slow',
    'unknown',
    'failed',
    'localFailed',
    'ended',
  ]);
  expect(channels[0].id).toBe('ended');
  expect(
    sortLiveLines(channels, local, now + LIVE_LINE_RESULT_TTL_MS)[0].id,
  ).toBe('localFailed');
});

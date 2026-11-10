import { act, renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import {
  type PlaybackSessionReport,
  PLAYBACK_BUCKET_MS,
} from '@/features/playback-stats/types';
import type { SearchResult } from '@/lib/types';

import {
  type PlaybackStatsEvent,
  usePlaybackStatsReporter,
} from './usePlaybackStatsReporter';

installCryptoPolyfill();

const START = Date.UTC(2026, 0, 1);
const originalFetch = global.fetch;
let monotonic = 0;
let wall = START;
let fetchMock: jest.Mock;

function response(historyId: string | null = 'history-1') {
  return { ok: true, json: async () => ({ success: true, historyId }) };
}

function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(episode = 0) {
  const player = {
    currentTime: 0,
    duration: 1200,
    video: {
      paused: false,
      seeking: false,
      ended: false,
      error: null,
      readyState: 4,
    },
  };
  const params = {
    artPlayerRef: { current: player as unknown as Artplayer },
    currentSourceRef: { current: 'source-a' },
    currentIdRef: { current: 'video-a' },
    videoTitleRef: { current: '测试剧' },
    detailRef: {
      current: {
        id: 'video-a',
        source: 'source-a',
        source_name: '源 A',
        title: '测试剧',
        poster: '',
        year: '2026',
        episodes: ['a', 'b', 'c', 'd'],
        episodes_titles: [],
        episode_groups: [
          { label: '第一组', count: 2 },
          { label: '第二组', count: 2 },
        ],
      } as SearchResult,
    },
    currentEpisodeIndexRef: { current: episode },
    stableCurrentTimeRef: { current: 0 },
  };
  const hook = renderHook(() => usePlaybackStatsReporter(params));
  const event = (value: PlaybackStatsEvent) =>
    act(() => hook.result.current.handlePlaybackStatsEvent(value));
  const advance = (ms: number, progress = ms / 1000) => {
    monotonic += ms;
    wall += ms;
    jest.setSystemTime(wall);
    player.currentTime += progress;
  };
  const tick = (ms = 1000, progress = ms / 1000) => {
    advance(ms, progress);
    event('timeupdate');
  };
  const flush = async () => {
    await act(async () => {
      hook.result.current.reportPlaybackStats(true);
    });
  };
  return { ...hook, params, player, event, advance, tick, flush };
}

function reports(): PlaybackSessionReport[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
}

beforeEach(() => {
  jest.useFakeTimers();
  monotonic = 0;
  wall = START;
  jest.setSystemTime(wall);
  jest.spyOn(performance, 'now').mockImplementation(() => monotonic);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  fetchMock = jest.fn().mockResolvedValue(response());
  global.fetch = fetchMock;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

describe('usePlaybackStatsReporter', () => {
  it('零观看不写入；倍速只按墙钟计时，停在同一帧不计时', async () => {
    const h = setup();
    act(() => h.result.current.startPlaybackStatsSession());
    await h.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    h.event('playing');
    h.tick(1000, 2);
    h.tick(1000, 0);
    h.tick(1000, 0.5);
    await h.flush();
    expect(reports()[0].buckets).toEqual([{ start: START, watch_ms: 2000 }]);
    expect(reports()[0].session).not.toHaveProperty('watch_seconds');
    expect(reports()[0].session).not.toHaveProperty('updated_at');
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
  });

  it.each([
    'pause',
    'waiting',
    'stalled',
    'seeking',
    'ended',
    'error',
  ] as const)('%s 停止计时，恢复播放后重新取样', async (stopEvent) => {
    const h = setup();
    h.event('playing');
    h.tick();
    h.event(stopEvent);
    h.tick(2000, 20);
    h.event('playing');
    h.tick();
    await h.flush();
    expect(reports().at(-1)?.buckets).toEqual([
      { start: START, watch_ms: 2000 },
    ]);
  });

  it('拖动跳跃不计时，seeked 后从新位置恢复；后退进度不用旧稳定位置覆盖', async () => {
    const h = setup();
    h.player.currentTime = 100;
    h.params.stableCurrentTimeRef.current = 100;
    h.event('playing');
    h.tick();
    h.player.video.seeking = true;
    h.event('seeking');
    h.tick(1000, 500);
    h.player.currentTime = 10;
    h.player.video.seeking = false;
    h.event('seeked');
    h.tick();
    await h.flush();
    expect(reports()[0].session.last_position).toBe(11);
    expect(reports()[0].buckets[0].watch_ms).toBe(2000);
  });

  it('原生暂停或低 readyState 也阻止 timeupdate 计时', async () => {
    const h = setup();
    h.event('playing');
    h.player.video.paused = true;
    h.tick();
    h.event('seeked');
    h.player.video.paused = false;
    h.player.video.readyState = 2;
    h.event('playing');
    h.tick();
    await h.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('跨 15 分钟边界按实际时间分桶', async () => {
    wall = START + PLAYBACK_BUCKET_MS - 1000;
    jest.setSystemTime(wall);
    const h = setup();
    h.event('playing');
    h.tick(3000, 6);
    await h.flush();
    expect(reports()[0].buckets).toEqual([
      { start: START, watch_ms: 1000 },
      { start: START + PLAYBACK_BUCKET_MS, watch_ms: 2000 },
    ]);
  });

  it('超过 5 秒的 tick 丢弃，下一次正常 tick 恢复计时', async () => {
    const h = setup();
    h.event('playing');
    h.tick(5001);
    h.tick();
    h.tick(60_000);
    await h.flush();
    expect(reports()[0].buckets[0].watch_ms).toBe(1000);
  });

  it('每 30 秒发送变化的桶，强制重复上报不增加累计值', async () => {
    const h = setup();
    h.event('playing');
    h.tick();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(reports()[0].buckets[0].watch_ms).toBe(1000);
    await h.flush();
    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    h.tick();
    await h.flush();
    expect(reports()[1].buckets[0].watch_ms).toBe(2000);
  });

  it('失败保留原累计值，下次上报重试', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const h = setup();
    h.event('playing');
    h.tick();
    await h.flush();
    await h.flush();
    expect(reports()[1]).toEqual(reports()[0]);
    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('换集新建会话并强制上报旧会话，各会话失败积压互不覆盖', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const h = setup();
    h.event('playing');
    h.tick();
    for (const episode of [1, 2]) {
      h.params.currentEpisodeIndexRef.current = episode;
      h.player.currentTime = 0;
      await act(async () => h.event('playing'));
      h.tick();
    }
    expect(reports().map((report) => report.session.episode_index)).toEqual([
      1, 2,
    ]);
    expect(new Set(reports().map((report) => report.session.id)).size).toBe(2);
    fetchMock.mockResolvedValue(response());
    await h.flush();
    const retried = reports().slice(2);
    expect(retried.map((report) => report.session.episode_index)).toEqual([
      1, 2, 3,
    ]);
    expect(retried.map((report) => report.buckets[0].watch_ms)).toEqual([
      1000, 1000, 1000,
    ]);
    expect(retried[0].session.last_position).toBe(1);
  });

  it('在途响应只确认发送快照，新增长在下次上报继续发送', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    const h = setup();
    h.event('playing');
    h.tick();
    await h.flush();
    h.tick();
    await act(async () => pending.resolve(response()));
    await h.flush();
    expect(reports().map((report) => report.buckets[0].watch_ms)).toEqual([
      1000, 2000,
    ]);
  });

  it('在途期间强制上报排队，完成后发送最新累计值', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    const h = setup();
    h.event('playing');
    h.tick();
    await h.flush();
    h.tick();
    h.event('pause');
    await act(async () => pending.resolve(response()));
    expect(reports().map((report) => report.buckets[0].watch_ms)).toEqual([
      1000, 2000,
    ]);
  });

  it('按作品复用 historyId，删除墓碑保留统计，换源隔离历史缓存', async () => {
    const h = setup(2);
    h.event('playing');
    h.tick();
    await h.flush();
    expect(reports()[0].history).toEqual({
      total_episodes: 4,
      group_label: '第二组',
      group_index: 1,
      group_total: 2,
    });
    h.params.currentEpisodeIndexRef.current = 3;
    h.event('playing');
    h.tick();
    fetchMock.mockResolvedValueOnce(response(null));
    await h.flush();
    expect(reports().at(-1)?.history).toEqual({
      id: 'history-1',
      total_episodes: 4,
      group_label: '第二组',
      group_index: 2,
      group_total: 2,
    });
    h.tick();
    await h.flush();
    expect(reports().at(-1)).not.toHaveProperty('history');
    expect(reports().at(-1)?.buckets[0].watch_ms).toBe(2000);
    h.params.currentSourceRef.current = 'source-b';
    h.event('playing');
    h.tick();
    await h.flush();
    expect(reports().at(-1)?.history).not.toHaveProperty('id');
  });

  it('首次请求返回 null 不标记删除，迟到成功响应不能覆盖删除墓碑', async () => {
    fetchMock.mockResolvedValueOnce(response(null));
    const h = setup();
    h.event('playing');
    h.tick();
    await h.flush();
    h.tick();
    await h.flush();
    expect(reports()[1].history).toBeDefined();
    const late = deferred();
    fetchMock.mockReturnValueOnce(late.promise);
    h.tick();
    await h.flush();
    h.params.currentEpisodeIndexRef.current = 1;
    h.event('playing');
    h.tick();
    fetchMock.mockResolvedValueOnce(response(null));
    await h.flush();
    await act(async () => late.resolve(response('history-1')));
    h.tick();
    await h.flush();
    expect(reports().at(-1)).not.toHaveProperty('history');
  });

  it.each(['pagehide', 'beforeunload', 'hidden', 'unmount'])(
    '%s 强制发送未上报桶',
    async (trigger) => {
      const h = setup();
      h.event('playing');
      h.tick();
      await act(async () => {
        if (trigger === 'unmount') h.unmount();
        else if (trigger === 'hidden') {
          jest
            .spyOn(document, 'visibilityState', 'get')
            .mockReturnValue('hidden');
          document.dispatchEvent(new Event('visibilitychange'));
        } else window.dispatchEvent(new Event(trigger));
      });
      expect(reports()[0].buckets[0].watch_ms).toBe(1000);
    },
  );

  it('同源同集恢复复用会话，stop 后 timeupdate 不再累加', async () => {
    const h = setup();
    h.event('playing');
    h.tick();
    await h.flush();
    h.event('stop');
    h.tick();
    h.event('playing');
    h.tick();
    await h.flush();
    expect(reports()[1].session.id).toBe(reports()[0].session.id);
    expect(reports()[1].buckets[0].watch_ms).toBe(2000);
  });
});

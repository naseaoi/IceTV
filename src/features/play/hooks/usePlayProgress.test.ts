import { act, renderHook } from '@testing-library/react';

import {
  type HistoryRestoreGate,
  isPlaybackCheckpointCompatibleWithDetail,
  isPlayRecordCompatibleWithDetail,
  peekHistoryRestoreEpisodeIndex,
  resolveNextStablePlaybackTime,
  resolvePlaybackRestoreCandidate,
  resolveProtectedPlaybackTime,
  saveCurrentPlayProgress,
  savePlaybackCheckpoint,
  shouldApplyHistoryRestore,
  usePlayProgress,
  waitForHistoryRestore,
} from '@/features/play/hooks/usePlayProgress';
import { PLAY_CHECKPOINT_KEY } from '@/features/play/lib/playTypes';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import { getAllPlayRecords, savePlayRecord } from '@/lib/db.client';
import { savePlayIntent } from '@/lib/play-intent';
import type { PlayRecord, SearchResult } from '@/lib/types';

jest.mock('@/lib/db.client', () => ({
  deletePlayRecord: jest.fn(),
  generateStorageKey: jest.fn(
    (source: string, id: string) => `${source}+${id}`,
  ),
  getAllPlayRecords: jest.fn(),
  savePlayRecord: jest.fn(),
}));

describe('usePlayProgress helpers', () => {
  const mockedSavePlayRecord = savePlayRecord as jest.MockedFunction<
    typeof savePlayRecord
  >;
  const detail = {
    id: 'id-a',
    title: '番剧A',
    poster: '',
    episodes: Array.from({ length: 12 }, (_, index) => `${index + 1}`),
    episodes_titles: [],
    source: 'source-a',
    source_name: '源A',
    year: '2024',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('异步历史读取不会覆盖已存在的 forced 恢复点', () => {
    expect(
      shouldApplyHistoryRestore({
        requestedSource: 'source-a',
        requestedId: 'id-a',
        requestedEpisodeIndex: 2,
        activeSource: 'source-a',
        activeId: 'id-a',
        activeEpisodeIndex: 2,
        allowAutoResume: true,
        pendingResumeTime: 456,
        pendingResumeMode: 'forced',
      }),
    ).toBe(false);
  });

  it('异步历史读取应用前会校验 source/id/episode 快照', () => {
    expect(
      shouldApplyHistoryRestore({
        requestedSource: 'source-a',
        requestedId: 'id-a',
        requestedEpisodeIndex: 2,
        activeSource: 'source-a',
        activeId: 'id-a',
        activeEpisodeIndex: 3,
        allowAutoResume: true,
        pendingResumeTime: null,
        pendingResumeMode: null,
      }),
    ).toBe(false);
  });

  it('快照一致且不存在 forced 恢复点时允许应用历史', () => {
    expect(
      shouldApplyHistoryRestore({
        requestedSource: 'source-a',
        requestedId: 'id-a',
        requestedEpisodeIndex: 2,
        activeSource: 'source-a',
        activeId: 'id-a',
        activeEpisodeIndex: 2,
        allowAutoResume: true,
        pendingResumeTime: 456,
        pendingResumeMode: 'history',
      }),
    ).toBe(true);
  });

  it('即使 forced 恢复点没有时间，也不能再让历史覆盖显式切集选择', () => {
    expect(
      shouldApplyHistoryRestore({
        requestedSource: 'source-a',
        requestedId: 'id-a',
        requestedEpisodeIndex: 8,
        activeSource: 'source-a',
        activeId: 'id-a',
        activeEpisodeIndex: 8,
        allowAutoResume: true,
        pendingResumeTime: 0,
        pendingResumeMode: 'forced',
      }),
    ).toBe(false);
  });

  it('首页记录比 checkpoint 更新时优先使用首页记录', () => {
    expect(
      resolvePlaybackRestoreCandidate({
        checkpoint: {
          source: 'source-a',
          id: 'id-a',
          episodeIndex: 7,
          currentTime: 1320,
          title: '番剧A',
          saveTime: 1000,
        },
        record: {
          title: '番剧A',
          source_name: '源A',
          year: '2024',
          cover: '',
          index: 8,
          total_episodes: 12,
          play_time: 180,
          total_time: 1500,
          save_time: 2000,
        },
        episodeCount: 12,
      }),
    ).toEqual({
      source: 'history',
      episodeIndex: 7,
      resumeTime: 180,
      resumeMode: 'history',
    });
  });

  it('分组源上游新增剧集后按分组标签恢复到原集', () => {
    expect(
      resolvePlaybackRestoreCandidate({
        checkpoint: null,
        record: {
          title: '番剧A',
          source_name: '源A',
          year: '2024',
          cover: '',
          index: 21,
          total_episodes: 22,
          group_index: 10,
          group_total: 11,
          group_label: '简中',
          play_time: 180,
          total_time: 1500,
          save_time: 2000,
        },
        episodeCount: 26,
        episodeGroups: [
          { label: '繁中', count: 13 },
          { label: '简中', count: 13 },
        ],
      }),
    ).toEqual({
      source: 'history',
      episodeIndex: 22,
      resumeTime: 180,
      resumeMode: 'history',
    });
  });

  it('checkpoint 更新时比首页记录更新时优先使用 checkpoint', () => {
    expect(
      resolvePlaybackRestoreCandidate({
        checkpoint: {
          source: 'source-a',
          id: 'id-a',
          episodeIndex: 7,
          currentTime: 240,
          title: '番剧A',
          saveTime: 3000,
        },
        record: {
          title: '番剧A',
          source_name: '源A',
          year: '2024',
          cover: '',
          index: 8,
          total_episodes: 12,
          play_time: 180,
          total_time: 1500,
          save_time: 2000,
        },
        episodeCount: 12,
      }),
    ).toEqual({
      source: 'checkpoint',
      episodeIndex: 7,
      resumeTime: 240,
      resumeMode: 'forced',
    });
  });

  it('零进度 checkpoint 不会覆盖首页已有进度', () => {
    expect(
      resolvePlaybackRestoreCandidate({
        checkpoint: {
          source: 'source-a',
          id: 'id-a',
          episodeIndex: 7,
          currentTime: 0,
          title: '番剧A',
          saveTime: 3000,
        },
        record: {
          title: '番剧A',
          source_name: '源A',
          year: '2024',
          cover: '',
          index: 8,
          total_episodes: 12,
          play_time: 180,
          total_time: 1500,
          save_time: 2000,
        },
        episodeCount: 12,
      }),
    ).toEqual({
      source: 'history',
      episodeIndex: 7,
      resumeTime: 180,
      resumeMode: 'history',
    });
  });

  it('历史记录集数越界时会裁剪到当前可播放范围', () => {
    expect(
      resolvePlaybackRestoreCandidate({
        checkpoint: null,
        record: {
          title: '番剧A',
          source_name: '源A',
          year: '2024',
          cover: '',
          index: 99,
          total_episodes: 99,
          play_time: 180,
          total_time: 1500,
          save_time: 2000,
        },
        episodeCount: 12,
      }),
    ).toEqual({
      source: 'history',
      episodeIndex: 11,
      resumeTime: 180,
      resumeMode: 'history',
    });
  });

  it('分组源缺少分组信息时会退化成过期绝对集索引', () => {
    const staleGroupedRecord = {
      title: '番剧A',
      source_name: '源A',
      year: '2024',
      cover: '',
      index: 32,
      total_episodes: 43,
      group_index: 10,
      group_total: 21,
      group_label: '第2季【全23话】',
      play_time: 180,
      total_time: 1500,
      save_time: 2000,
    };

    expect(
      resolvePlaybackRestoreCandidate({
        checkpoint: null,
        record: staleGroupedRecord,
        episodeCount: 59,
      }),
    ).toEqual({
      source: 'history',
      episodeIndex: 31,
      resumeTime: 180,
      resumeMode: 'history',
    });

    expect(
      resolvePlaybackRestoreCandidate({
        checkpoint: null,
        record: staleGroupedRecord,
        episodeCount: 59,
        episodeGroups: [
          { label: '第1季【全24话】', count: 24 },
          { label: '第2季【全23话】', count: 23 },
          { label: '第3季 前篇【全12话】', count: 12 },
        ],
      }),
    ).toEqual({
      source: 'history',
      episodeIndex: 33,
      resumeTime: 180,
      resumeMode: 'history',
    });
  });

  it('source/id 相同但标题不同时不使用历史记录', () => {
    expect(
      isPlayRecordCompatibleWithDetail(
        {
          title: '番剧B',
          source_name: '源A',
          year: '2024',
          cover: '',
          index: 1,
          total_episodes: 12,
          play_time: 1320,
          total_time: 1500,
          save_time: 2000,
        },
        detail,
      ),
    ).toBe(false);
  });

  it('source/id 相同但年份不同时不使用历史记录', () => {
    expect(
      isPlayRecordCompatibleWithDetail(
        {
          title: '番剧A',
          source_name: '源A',
          year: '2023',
          cover: '',
          index: 1,
          total_episodes: 12,
          play_time: 1320,
          total_time: 1500,
          save_time: 2000,
        },
        detail,
      ),
    ).toBe(false);
  });

  it('source/id 相同但 checkpoint 标题不同时不使用检查点', () => {
    expect(
      isPlaybackCheckpointCompatibleWithDetail(
        {
          source: 'source-a',
          id: 'id-a',
          episodeIndex: 0,
          currentTime: 1320,
          title: '番剧B',
          saveTime: 2000,
        },
        detail,
      ),
    ).toBe(false);
  });

  it('起播前预判续播的集与恢复取舍一致：不采用标题不符的记录，恢复点较新时取恢复点', () => {
    const record = {
      title: '番剧A',
      source_name: '源A',
      year: '2024',
      cover: '',
      index: 8,
      total_episodes: 12,
      play_time: 180,
      total_time: 1500,
      save_time: 2000,
    };
    const key = 'source-a+id-a';

    expect(peekHistoryRestoreEpisodeIndex(detail, null)).toBeNull();
    expect(peekHistoryRestoreEpisodeIndex(detail, { [key]: record })).toBe(7);
    expect(
      peekHistoryRestoreEpisodeIndex(detail, {
        [key]: { ...record, title: '番剧B' },
      }),
    ).toBeNull();

    sessionStorage.setItem(
      PLAY_CHECKPOINT_KEY,
      JSON.stringify({
        source: 'source-a',
        id: 'id-a',
        episodeIndex: 4,
        currentTime: 240,
        title: '番剧A',
        saveTime: Date.now(),
      }),
    );
    expect(peekHistoryRestoreEpisodeIndex(detail, { [key]: record })).toBe(4);
  });

  it('保存进度时会优先使用播放器时间，否则回退到最近稳定进度', () => {
    expect(resolveProtectedPlaybackTime(331.8, 180)).toBe(331);
    expect(resolveProtectedPlaybackTime(0.2, 330)).toBe(330);
    expect(resolveProtectedPlaybackTime(0, 0)).toBe(0);
  });

  it('目标集尚未真正起播前不会回写旧稳定进度', () => {
    expect(resolveNextStablePlaybackTime(1320.8, 0, true)).toBe(0);
    expect(resolveNextStablePlaybackTime(1320.8, 0, false)).toBe(1320);
  });

  it('切到目标集但尚未起播前不会把旧集进度保存到记录', async () => {
    await saveCurrentPlayProgress(
      {
        current: {
          currentTime: 1320.8,
          duration: 1500,
        },
      } as any,
      { current: 'source-a' },
      { current: 'id-a' },
      { current: '番剧A' },
      {
        current: {
          source_name: '源A',
          year: '2024',
          poster: '',
          episodes: Array.from({ length: 12 }, (_, index) => `${index + 1}`),
        },
      } as any,
      { current: 8 },
      { current: 1320 },
      { current: true },
      {
        current: {
          inFlight: false,
          pending: null,
          lastSavedFingerprint: null,
        },
      },
      { current: 0 },
      '番剧A',
    );

    expect(mockedSavePlayRecord).not.toHaveBeenCalled();
  });

  it('保存进度携带当前详情的作品状态', async () => {
    await saveCurrentPlayProgress(
      { current: { currentTime: 120, duration: 1500 } } as any,
      { current: 'source-a' },
      { current: 'id-a' },
      { current: '番剧A' },
      { current: { ...detail, series_status: 'ended' } },
      { current: 0 },
      { current: 120 },
      { current: false },
      {
        current: { inFlight: false, pending: null, lastSavedFingerprint: null },
      },
      { current: 0 },
      '番剧A',
    );
    expect(mockedSavePlayRecord).toHaveBeenCalledWith(
      'source-a',
      'id-a',
      expect.objectContaining({ series_status: 'ended' }),
    );
  });

  it('起播前的 0 进度不写 checkpoint，避免覆盖真实进度', () => {
    savePlaybackCheckpoint(
      { current: 'source-a' },
      { current: 'id-a' },
      { current: 0 },
      { current: '番剧A' },
      { current: null } as any,
      { current: 0 },
      { current: false },
    );

    expect(sessionStorage.getItem(PLAY_CHECKPOINT_KEY)).toBeNull();
  });

  it('已起播时正常写入 checkpoint', () => {
    savePlaybackCheckpoint(
      { current: 'source-a' },
      { current: 'id-a' },
      { current: 4 },
      { current: '番剧A' },
      { current: { currentTime: 886.4 } } as any,
      { current: 886 },
      { current: false },
    );

    const stored = JSON.parse(
      sessionStorage.getItem(PLAY_CHECKPOINT_KEY) || '{}',
    );
    expect(stored.episodeIndex).toBe(4);
    expect(stored.currentTime).toBe(886);
  });

  it('切到目标集但尚未起播前不会写入错误 checkpoint', () => {
    savePlaybackCheckpoint(
      { current: 'source-a' },
      { current: 'id-a' },
      { current: 8 },
      { current: '番剧A' },
      {
        current: {
          currentTime: 1320.8,
        },
      } as any,
      { current: 1320 },
      { current: true },
    );

    expect(sessionStorage.getItem(PLAY_CHECKPOINT_KEY)).toBeNull();
  });
});

describe('usePlayProgress 历史恢复与起播握手', () => {
  const mockedGetAllPlayRecords = getAllPlayRecords as jest.MockedFunction<
    typeof getAllPlayRecords
  >;
  const detail: SearchResult = {
    id: 'id-a',
    title: '番剧A',
    poster: '',
    episodes: Array.from({ length: 12 }, (_, index) => `${index + 1}`),
    episodes_titles: [],
    source: 'source-a',
    source_name: '源A',
    year: '2024',
  };
  const recordKey = 'source-a+id-a';
  const recordAtEpisode9: PlayRecord = {
    title: '番剧A',
    source_name: '源A',
    year: '2024',
    cover: '',
    index: 9,
    total_episodes: 12,
    play_time: 600,
    total_time: 1500,
    save_time: 2000,
  };

  function createHistoryRestoreGate(): HistoryRestoreGate {
    return { playRecords: null, settledKey: '', listeners: new Set() };
  }

  function renderHistoryRestore(gate: HistoryRestoreGate, episodeIndex = 0) {
    const refs = {
      artPlayerRef: { current: null },
      currentSourceRef: { current: detail.source },
      currentIdRef: { current: detail.id },
      videoTitleRef: { current: detail.title },
      detailRef: { current: detail as SearchResult | null },
      currentEpisodeIndexRef: { current: episodeIndex },
      resumeTimeRef: { current: null as number | null },
      resumeModeRef: { current: null as ResumeMode },
      allowAutoResumeRef: { current: true },
      stableCurrentTimeRef: { current: 0 },
      clearTargetEpisodeProgressRef: { current: false },
      saveStateRef: {
        current: { inFlight: false, pending: null, lastSavedFingerprint: null },
      },
      lastSaveTimeRef: { current: 0 },
      saveIntervalRef: { current: null },
      wakeLockRef: { current: null },
      historyRestoreGateRef: { current: gate },
    };
    const setCurrentEpisodeIndex = jest.fn();
    const cleanupPlayer = jest.fn();
    const view = renderHook(
      ({ currentDetail }: { currentDetail: SearchResult }) =>
        usePlayProgress({
          ...refs,
          searchTitle: detail.title,
          currentSource: detail.source,
          currentId: detail.id,
          currentEpisodeIndex: episodeIndex,
          detail: currentDetail,
          setCurrentEpisodeIndex,
          cleanupPlayer,
        }),
      { initialProps: { currentDetail: detail } },
    );
    return { ...view, refs, setCurrentEpisodeIndex };
  }

  // 只冲刷微任务不推进计时器，放行只可能来自历史恢复的信号
  async function flushMicrotasks() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve();
      }
    });
  }

  function trackRelease(gate: HistoryRestoreGate) {
    const released = jest.fn();
    void waitForHistoryRestore(gate, detail, 1_000).then(released);
    return released;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockedGetAllPlayRecords.mockReset();
    mockedGetAllPlayRecords.mockResolvedValue({});
    sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('写好续播的集和时间才放行起播，复用起播前已发出的播放记录请求', async () => {
    let resolveRecords!: (records: Record<string, PlayRecord>) => void;
    const gate = createHistoryRestoreGate();
    gate.playRecords = new Promise((resolve) => {
      resolveRecords = resolve;
    });
    const { refs, setCurrentEpisodeIndex } = renderHistoryRestore(gate);
    let stateAtRelease: unknown = null;
    void waitForHistoryRestore(gate, detail, 1_000).then(() => {
      stateAtRelease = {
        episodeIndexes: setCurrentEpisodeIndex.mock.calls.map(
          ([value]) => value,
        ),
        resumeTime: refs.resumeTimeRef.current,
        resumeMode: refs.resumeModeRef.current,
      };
    });

    await flushMicrotasks();
    expect(stateAtRelease).toBeNull();

    resolveRecords({ [recordKey]: recordAtEpisode9 });
    await flushMicrotasks();

    expect(stateAtRelease).toEqual({
      episodeIndexes: [8],
      resumeTime: 600,
      resumeMode: 'history',
    });
    expect(mockedGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it('当前集已是续播的集时不再换集，续播时间照样写入', async () => {
    mockedGetAllPlayRecords.mockResolvedValue({
      [recordKey]: recordAtEpisode9,
    });
    const gate = createHistoryRestoreGate();
    const { refs, setCurrentEpisodeIndex } = renderHistoryRestore(gate, 8);
    const released = trackRelease(gate);

    await flushMicrotasks();

    expect(released).toHaveBeenCalledTimes(1);
    expect(setCurrentEpisodeIndex).not.toHaveBeenCalled();
    expect(refs.resumeTimeRef.current).toBe(600);
    expect(refs.resumeModeRef.current).toBe('history');
  });

  it('恢复点比播放记录新时仍按恢复点续播', async () => {
    savePlaybackCheckpoint(
      { current: detail.source },
      { current: detail.id },
      { current: 4 },
      { current: detail.title },
      { current: { currentTime: 240 } } as any,
      { current: 240 },
      { current: false },
    );
    mockedGetAllPlayRecords.mockResolvedValue({
      [recordKey]: recordAtEpisode9,
    });
    const gate = createHistoryRestoreGate();
    const { refs, setCurrentEpisodeIndex } = renderHistoryRestore(gate);
    const released = trackRelease(gate);

    await flushMicrotasks();

    expect(released).toHaveBeenCalledTimes(1);
    expect(setCurrentEpisodeIndex).toHaveBeenCalledWith(4);
    expect(refs.resumeTimeRef.current).toBe(240);
    expect(refs.resumeModeRef.current).toBe('forced');
  });

  it('没有可用记录或读取失败时也立即放行，不等到上限', async () => {
    const noRecordGate = createHistoryRestoreGate();
    const { setCurrentEpisodeIndex } = renderHistoryRestore(noRecordGate);
    const releasedWithoutRecord = trackRelease(noRecordGate);
    await flushMicrotasks();
    expect(releasedWithoutRecord).toHaveBeenCalledTimes(1);
    expect(setCurrentEpisodeIndex).not.toHaveBeenCalled();

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const failedGate = createHistoryRestoreGate();
    failedGate.playRecords = Promise.reject(new Error('network'));
    renderHistoryRestore(failedGate);
    const releasedAfterFailure = trackRelease(failedGate);
    await flushMicrotasks();
    expect(releasedAfterFailure).toHaveBeenCalledTimes(1);
  });

  it('播放意图直接放行，不读取播放记录', async () => {
    savePlayIntent({
      source: detail.source,
      id: detail.id,
      episodeIndex: 4,
      resumeTime: 300,
    });
    const gate = createHistoryRestoreGate();
    const { refs, setCurrentEpisodeIndex } = renderHistoryRestore(gate);
    const released = trackRelease(gate);

    await flushMicrotasks();

    expect(released).toHaveBeenCalledTimes(1);
    expect(setCurrentEpisodeIndex).toHaveBeenCalledWith(4);
    expect(refs.resumeTimeRef.current).toBe(300);
    expect(refs.resumeModeRef.current).toBe('forced');
    expect(mockedGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it('读取记录期间详情刷新会重跑恢复，这次恢复不丢失', async () => {
    let resolveFirstRead!: (records: Record<string, PlayRecord>) => void;
    mockedGetAllPlayRecords
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRead = resolve;
          }),
      )
      .mockResolvedValue({ [recordKey]: recordAtEpisode9 });
    const gate = createHistoryRestoreGate();
    const { refs, rerender, setCurrentEpisodeIndex } =
      renderHistoryRestore(gate);
    const released = trackRelease(gate);

    const refreshedDetail = { ...detail };
    refs.detailRef.current = refreshedDetail;
    rerender({ currentDetail: refreshedDetail });
    await flushMicrotasks();

    expect(released).toHaveBeenCalledTimes(1);
    expect(setCurrentEpisodeIndex).toHaveBeenCalledWith(8);
    expect(refs.resumeTimeRef.current).toBe(600);

    resolveFirstRead({ [recordKey]: recordAtEpisode9 });
    await flushMicrotasks();
    expect(setCurrentEpisodeIndex).toHaveBeenCalledTimes(1);
  });

  it('没有信号时到上限才放行', async () => {
    const gate = createHistoryRestoreGate();
    const released = trackRelease(gate);

    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(released).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(released).toHaveBeenCalledTimes(1);
    expect(gate.listeners.size).toBe(0);
  });
});

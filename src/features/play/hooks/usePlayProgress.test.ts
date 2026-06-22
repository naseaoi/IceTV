import {
  resolveNextStablePlaybackTime,
  resolveProtectedPlaybackTime,
  resolvePlaybackRestoreCandidate,
  isPlayRecordCompatibleWithDetail,
  isPlaybackCheckpointCompatibleWithDetail,
  saveCurrentPlayProgress,
  savePlaybackCheckpoint,
  shouldApplyHistoryRestore,
} from '@/features/play/hooks/usePlayProgress';
import { PLAY_CHECKPOINT_KEY } from '@/features/play/lib/playTypes';
import { savePlayRecord } from '@/lib/db.client';

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

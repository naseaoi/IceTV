import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';

import { usePlayInit } from '@/features/play/hooks/usePlayInit';
import {
  type HistoryRestoreGate,
  usePlayProgress,
} from '@/features/play/hooks/usePlayProgress';
import { saveDetailSnapshot } from '@/features/play/lib/detailSnapshot';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import { generateStorageKey } from '@/lib/db.client';
import { cacheManager } from '@/lib/db.client.cache';
import { savePlayIntent } from '@/lib/play-intent';
import { getPlayRecordResumeGroup } from '@/lib/play-records';
import type { EpisodeGroup, PlayRecord, SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/vodProbe', () => ({
  probeVodEpisodeUrl: jest.fn(),
}));

jest.mock('@/lib/player-runtime', () => ({
  prefetchM3U8: jest.fn(),
}));

const TITLE = '碧蓝之海 第三季';
const SOURCE = 'src';
const VIDEO_ID = 'vid';

function episodeUrl(groupIndex: number, episode: number) {
  return `https://src.example/${groupIndex}-${episode}.m3u8`;
}

function createDetail(groupCounts: number[], labels?: string[]): SearchResult {
  const episodes = groupCounts.flatMap((count, groupIndex) =>
    Array.from({ length: count }, (_, index) =>
      episodeUrl(groupIndex, index + 1),
    ),
  );
  const episodeGroups: EpisodeGroup[] | undefined = labels
    ? labels.map((label, index) => ({ label, count: groupCounts[index] }))
    : undefined;
  return {
    id: VIDEO_ID,
    title: TITLE,
    poster: '',
    episodes,
    episodes_titles: episodes.map((_, index) => `${index + 1}`),
    source: SOURCE,
    source_name: '测试源',
    year: '2026',
    episode_groups: episodeGroups,
  };
}

function createRecord(fields: Partial<PlayRecord>): PlayRecord {
  return {
    title: TITLE,
    source_name: '测试源',
    year: '2026',
    cover: '',
    index: 1,
    total_episodes: 1,
    play_time: 600,
    total_time: 1440,
    save_time: Date.now(),
    ...fields,
  };
}

function signIn() {
  document.cookie = `auth_meta=${encodeURIComponent(
    JSON.stringify({ username: 'tester' }),
  )}`;
}

function installFetch(
  detailResponse: Promise<SearchResult>,
  records: Record<string, PlayRecord>,
) {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    const respond = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
    });
    if (url.pathname === '/api/detail') return detailResponse.then(respond);
    if (url.pathname === '/api/search') {
      return Promise.resolve(respond({ results: [] }));
    }
    if (url.pathname === '/api/playrecords') {
      return Promise.resolve(respond(records));
    }
    return Promise.reject(new Error(`unexpected request: ${url.pathname}`));
  }) as unknown as typeof fetch;
}

// 按 usePlayPageState 的方式持有状态并在提交后同步 ref，把初始化与历史恢复接在一起
function usePlayPageHarness() {
  const [currentSource, setCurrentSource] = useState(SOURCE);
  const [currentId, setCurrentId] = useState(VIDEO_ID);
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [noop] = useState(() => jest.fn());

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const detailRef = useRef(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const videoTitleRef = useRef(TITLE);
  const videoYearRef = useRef('2026');
  const historyRestoreGateRef = useRef<HistoryRestoreGate>({
    playRecords: null,
    settledKey: '',
    listeners: new Set(),
  });

  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
  }, [currentSource, currentId, detail, currentEpisodeIndex]);

  usePlayInit({
    currentSource,
    currentId,
    currentSourceRef,
    currentIdRef,
    playbackStartedSourceRef: useRef(null),
    videoTitle: TITLE,
    searchTitle: TITLE,
    searchType: '',
    needPreferRef: useRef(false),
    videoTitleRef,
    videoYearRef,
    currentEpisodeIndex,
    optimizationEnabled: true,
    historyRestoreGateRef,
    setLoading,
    setLoadingStage: noop,
    setLoadingMessage: noop,
    setError: noop,
    setDetail,
    setCurrentSource,
    setCurrentId,
    setVideoTitle: noop,
    setVideoYear: noop,
    setVideoCover: noop,
    setVideoDoubanId: noop,
    setCurrentEpisodeIndex,
    setNeedPrefer: noop,
    setAvailableSources: noop,
    setSourceSearchLoading: noop,
    setSourceSearchError: noop,
    setPrecomputedVideoInfo: noop,
    setSourceRecommendation: noop,
  });

  usePlayProgress({
    artPlayerRef: useRef(null),
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    detailRef,
    currentEpisodeIndexRef,
    resumeTimeRef: useRef<number | null>(null),
    resumeModeRef: useRef<ResumeMode>(null),
    allowAutoResumeRef: useRef(true),
    stableCurrentTimeRef: useRef(0),
    clearTargetEpisodeProgressRef: useRef(false),
    saveStateRef: useRef({
      inFlight: false,
      pending: null,
      lastSavedFingerprint: null,
    }),
    lastSaveTimeRef: useRef(0),
    saveIntervalRef: useRef(null),
    wakeLockRef: useRef(null),
    historyRestoreGateRef,
    searchTitle: TITLE,
    currentSource,
    currentId,
    currentEpisodeIndex,
    detail,
    setCurrentEpisodeIndex,
    cleanupPlayer: noop,
  });

  return { detail, currentEpisodeIndex, loading };
}

const originalFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  signIn();
  window.history.replaceState(
    {},
    '',
    `/play?source=${SOURCE}&id=${VIDEO_ID}&title=${encodeURIComponent(TITLE)}`,
  );
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

// 源站从 10 集更新到 11 集：本地详情快照仍是旧集数，后台回源的新详情在历史恢复之后才到
describe.each([
  {
    kind: '普通源',
    staleDetail: createDetail([10]),
    freshDetail: createDetail([11]),
    record: createRecord({ index: 10, total_episodes: 10 }),
    expectedUrl: episodeUrl(0, 10),
  },
  {
    kind: '分组源（记录仍是 10/10）',
    staleDetail: createDetail([10, 10], ['繁中', '简中']),
    freshDetail: createDetail([11, 11], ['繁中', '简中']),
    record: createRecord({
      index: 20,
      total_episodes: 20,
      group_index: 10,
      group_total: 10,
      group_label: '简中',
    }),
    expectedUrl: episodeUrl(1, 10),
  },
  {
    kind: '分组源（记录已刷新为 10/11）',
    staleDetail: createDetail([10, 10], ['繁中', '简中']),
    freshDetail: createDetail([11, 11], ['繁中', '简中']),
    record: createRecord({
      index: 21,
      total_episodes: 22,
      group_index: 10,
      group_total: 11,
      group_label: '简中',
    }),
    expectedUrl: episodeUrl(1, 10),
  },
])('$kind 看完第 10 集后源站更新到 11 集', (scenario) => {
  async function playAndRefreshDetail(withIntent: boolean) {
    const records = {
      [generateStorageKey(SOURCE, VIDEO_ID)]: scenario.record,
    };
    cacheManager.cachePlayRecords(records);
    saveDetailSnapshot(SOURCE, VIDEO_ID, scenario.staleDetail);
    if (withIntent) {
      // 与继续观看卡片的传参一致
      const resumeGroup = getPlayRecordResumeGroup(scenario.record);
      savePlayIntent({
        source: SOURCE,
        id: VIDEO_ID,
        episodeIndex: Math.max(0, scenario.record.index - 1),
        resumeTime: scenario.record.play_time,
        groupLabel: resumeGroup?.label,
        groupIndex: resumeGroup?.index,
        groupTotal: resumeGroup?.total,
      });
    }

    let resolveDetail!: (detail: SearchResult) => void;
    installFetch(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
      records,
    );

    const { result } = renderHook(() => usePlayPageHarness());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const current = () =>
      result.current.detail?.episodes[result.current.currentEpisodeIndex];
    expect(current()).toBe(scenario.expectedUrl);

    await act(async () => {
      resolveDetail(scenario.freshDetail);
    });
    await waitFor(() =>
      expect(result.current.detail?.episodes).toHaveLength(
        scenario.freshDetail.episodes.length,
      ),
    );
    return current();
  }

  it('首页点击继续观看仍播第 10 集', async () => {
    await expect(playAndRefreshDetail(true)).resolves.toBe(
      scenario.expectedUrl,
    );
  });

  it('直接打开播放页按播放记录仍恢复到第 10 集', async () => {
    await expect(playAndRefreshDetail(false)).resolves.toBe(
      scenario.expectedUrl,
    );
  });
});

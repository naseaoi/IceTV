import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { PlayPageClient } from '@/features/play/PlayPageClient';
import { generateStorageKey } from '@/lib/db.client';
import { savePlayIntent } from '@/lib/play-intent';
import type { PlayRecord, SearchResult } from '@/lib/types';
import { clearPlaybackWarmups } from '@/lib/video-prefetch';

type ArtPlayerParams = Parameters<typeof useArtPlayer>[0];

// 页面每次渲染交给播放器的起播参数
interface PlayerFrame {
  loading: boolean;
  videoUrl: string;
  detailSource: string | null;
  episodeIndex: number;
  resumeTime: number | null;
  resumeMode: ResumeMode;
}

let mockSearchParams = new URLSearchParams();
const mockPlayerFrames: PlayerFrame[] = [];
const mockSourceSwitch = {
  handleSourceChange: jest.fn(),
  handleLoadingTimeout: jest.fn(),
  handlePlaybackRecoveryExhausted: jest.fn(),
  handleEpisodeUrlResolveFailed: jest.fn(),
  resetAutoSourceSwitch: jest.fn(),
  finalizePendingSourceSwitchCleanup: jest.fn(),
  stopActiveHlsLoading: jest.fn(),
  restartCurrentPlayback: jest.fn(),
  showPendingPlaybackNotice: jest.fn(),
};

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/components/AuthenticatedRoute', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/features/play/components/PlayMainContent', () => ({
  PlayMainContent: () => null,
}));

jest.mock('@/features/play/components/PlayStateViews', () => ({
  PlayErrorView: () => null,
  PlayLoadingView: () => null,
}));

jest.mock('@/features/play/hooks/useArtPlayer', () => ({
  useArtPlayer: (params: ArtPlayerParams) => {
    mockPlayerFrames.push({
      loading: params.loading,
      videoUrl: params.videoUrl,
      detailSource: params.detail?.source ?? null,
      episodeIndex: params.currentEpisodeIndex,
      resumeTime: params.resumeTimeRef.current,
      resumeMode: params.resumeModeRef.current,
    });
  },
}));

jest.mock('@/features/play/hooks/useAuthRecovery', () => ({
  useAuthRecovery: () => ({
    authRecoveryVisible: false,
    authRecoveryReasonMessage: '',
    dismissAuthRecovery: jest.fn(),
    handleReloginAndRecover: jest.fn(),
  }),
}));

jest.mock('@/features/play/hooks/useDanmakuPreference', () => ({
  useDanmakuPreference: () => ({
    enabledRef: { current: false },
    onEnabledChange: jest.fn(),
  }),
}));

jest.mock('@/features/play/hooks/useDanmakuWarmup', () => ({
  useDanmakuWarmup: jest.fn(),
}));

jest.mock('@/features/play/hooks/useEpisodeSwitch', () => ({
  useEpisodeSwitch: () => ({
    handleEpisodeChange: jest.fn(),
    handlePreviousEpisode: jest.fn(),
    handleNextEpisode: jest.fn(),
  }),
}));

jest.mock('@/features/play/hooks/usePlayFavorite', () => ({
  usePlayFavorite: () => ({ handleToggleFavorite: jest.fn() }),
}));

jest.mock('@/features/play/hooks/useSkipConfig', () => ({
  useSkipConfig: () => ({
    handleSkipConfigChange: jest.fn(),
    registerSkipConfigMigration: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock('@/features/play/hooks/useSourcePlaybackStatsRecorder', () => ({
  useSourcePlaybackStatsRecorder: () => ({
    recordPlaybackStarted: jest.fn(),
    recordPlaybackFailed: jest.fn(),
  }),
}));

jest.mock('@/features/play/hooks/useSourceSwitch', () => ({
  useSourceSwitch: () => mockSourceSwitch,
}));

jest.mock('@/features/play/lib/danmaku/attach', () => ({
  applyDanmakuHeatmapVisibility: jest.fn(),
  ensureDanmakuLoaded: jest.fn(),
  preloadDanmakuPluginIfEnabled: jest.fn(),
  reloadDanmaku: jest.fn(),
}));

jest.mock('@/features/play/lib/nextEpisodePreload', () => ({
  cancelNextEpisodePreload: jest.fn(),
}));

jest.mock('@/features/play/lib/sourceProbeStore', () => ({
  ...jest.requireActual('@/features/play/lib/sourceProbeStore'),
  writePlayerInfo: jest.fn(),
}));

jest.mock('@/features/play/lib/vodHlsRuntime', () => ({
  getVodRuntimeSourceUrl: () => null,
}));

jest.mock('@/features/play/lib/vodProbe', () => ({
  probeVodEpisodeUrl: jest.fn(),
}));

jest.mock('@/features/playback-stats/hooks/usePlaybackStatsReporter', () => ({
  usePlaybackStatsReporter: () => ({
    startPlaybackStatsSession: jest.fn(),
    reportPlaybackStats: jest.fn(),
    handlePlaybackStatsEvent: jest.fn(),
  }),
}));

jest.mock('@/hooks/useBackNavigation', () => ({
  useBackNavigation: () => jest.fn(),
}));

jest.mock('@/hooks/usePlayerKeyboard', () => ({
  usePlayerKeyboard: jest.fn(),
}));

jest.mock('@/lib/player-runtime', () => ({
  destroyManagedHls: jest.fn(),
  preloadPlayerModules: jest.fn(),
  prefetchM3U8: jest.fn(),
  runManagedVideoCleanup: jest.fn(),
}));

const TITLE = '续播剧';
const RESUME_EPISODE_INDEX = 8;
const RECORD_PLAY_TIME = 600;
const probeMock = probeVodEpisodeUrl as jest.MockedFunction<
  typeof probeVodEpisodeUrl
>;
const originalFetch = global.fetch;

function createSeries(source: string): SearchResult {
  const episodes = Array.from(
    { length: 10 },
    (_, index) => `https://${source}.example/${index + 1}.m3u8`,
  );
  return {
    id: `${source}-id`,
    title: TITLE,
    poster: '',
    episodes,
    episodes_titles: episodes.map((_, index) => `第${index + 1}集`),
    source,
    source_name: source.toUpperCase(),
    year: '2024',
  };
}

function createPlayRecords(series: SearchResult): Record<string, PlayRecord> {
  return {
    [generateStorageKey(series.source, series.id)]: {
      title: series.title,
      source_name: series.source_name,
      year: series.year,
      cover: '',
      index: RESUME_EPISODE_INDEX + 1,
      total_episodes: series.episodes.length,
      play_time: RECORD_PLAY_TIME,
      total_time: 1500,
      save_time: Date.now(),
    },
  };
}

// 播放记录按登录用户分区，未登录不发请求
function signIn() {
  document.cookie = `auth_meta=${encodeURIComponent(
    JSON.stringify({ username: 'tester' }),
  )}`;
}

type ApiRoute = () => Promise<unknown>;

function reply(body: unknown, status = 200): ApiRoute {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
}

function deferredReply() {
  let resolve!: (body: unknown) => void;
  const body = new Promise<unknown>((settle) => {
    resolve = settle;
  });
  const route: ApiRoute = () =>
    body.then((value) => ({ ok: true, status: 200, json: async () => value }));
  return { route, resolve };
}

function installFetch(routes: Record<string, ApiRoute>) {
  const allRoutes: Record<string, ApiRoute> = {
    '/api/proxy-modes': reply({}),
    ...routes,
  };
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const { pathname, searchParams } = new URL(
      String(input),
      window.location.origin,
    );
    if (pathname === '/api/playrecords' && searchParams.has('title'))
      return (allRoutes['/api/playrecords?title'] || reply({}))();
    const route = allRoutes[pathname];
    return route
      ? route()
      : Promise.reject(new Error(`unexpected request: ${pathname}`));
  }) as unknown as typeof fetch;
}

function requestCount(pathname: string): number {
  return (global.fetch as jest.Mock).mock.calls.filter(
    ([input]) =>
      new URL(String(input), window.location.origin).pathname === pathname &&
      !new URL(String(input), window.location.origin).searchParams.has('title'),
  ).length;
}

// 聚合卡片先把候选源写进会话存储，继续观看等入口直接带源和 id
function openPlayPage(
  query: Record<string, string>,
  aggregateGroup?: SearchResult[],
) {
  const params = new URLSearchParams({ title: TITLE, ...query });
  window.history.replaceState({}, '', `/play?${params.toString()}`);
  mockSearchParams = params;
  if (aggregateGroup) {
    sessionStorage.setItem('aggregate_group', JSON.stringify(aggregateGroup));
  }
  render(<PlayPageClient />);
}

// 只推进微任务与 React 更新，不推进计时器，放行时刻才能精确到上限
async function flushStartup() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      for (let tick = 0; tick < 20; tick += 1) {
        await Promise.resolve();
      }
    });
  }
}

async function advanceTime(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flushStartup();
}

const released = () => mockPlayerFrames.some((frame) => !frame.loading);
// 放行后播放器第一次拿到播放地址时的参数，就是它创建时用的参数
const startupFrame = () =>
  mockPlayerFrames.find((frame) => !frame.loading && frame.videoUrl);
const playerUrls = () =>
  new Set(mockPlayerFrames.map((frame) => frame.videoUrl).filter(Boolean));

describe('PlayPageClient 起播等历史恢复', () => {
  const resumed = createSeries('a');
  const other = createSeries('b');

  beforeEach(() => {
    jest.useFakeTimers();
    clearPlaybackWarmups();
    clearPlaybackWarmups();
    localStorage.clear();
    sessionStorage.clear();
    mockPlayerFrames.length = 0;
    probeMock.mockReset();
    signIn();
  });

  afterEach(() => {
    cleanup();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
    document.cookie = 'auth_meta=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.dispatchEvent(new Event('auth:session-lost'));
  });

  it('标题入口按本人其他源最近记录起播，保留集与时间', async () => {
    installFetch({
      '/api/playrecords?title': reply(createPlayRecords(resumed)),
      '/api/search/quick': reply({ detail: other }),
      '/api/detail': reply(resumed),
      '/api/search': reply({ results: [resumed, other] }),
    });
    openPlayPage({});
    await flushStartup();
    expect(startupFrame()).toMatchObject({
      videoUrl: resumed.episodes[RESUME_EPISODE_INDEX],
      episodeIndex: RESUME_EPISODE_INDEX,
      resumeTime: RECORD_PLAY_TIME,
    });
    expect(playerUrls()).not.toContain(other.episodes[0]);
  });

  it('测速选完源后播放记录才到时，等历史恢复定下续播的集和时间再起播', async () => {
    const playRecords = deferredReply();
    installFetch({ '/api/playrecords': playRecords.route });
    probeMock.mockImplementation(async (rawUrl) => {
      if (rawUrl === resumed.episodes[0]) {
        return { quality: '1080p', loadSpeed: '2.0 MB/s', pingTime: 120 };
      }
      throw new Error('Failed to load playlist');
    });

    openPlayPage({ prefer: 'true' }, [resumed, other]);
    await flushStartup();

    expect(probeMock).toHaveBeenCalled();
    expect(mockPlayerFrames[mockPlayerFrames.length - 1]).toMatchObject({
      loading: true,
      detailSource: resumed.source,
    });
    expect(playerUrls().size).toBe(0);

    await act(async () => {
      playRecords.resolve(createPlayRecords(resumed));
    });
    await flushStartup();

    expect(startupFrame()).toEqual({
      loading: false,
      videoUrl: resumed.episodes[RESUME_EPISODE_INDEX],
      detailSource: resumed.source,
      episodeIndex: RESUME_EPISODE_INDEX,
      resumeTime: RECORD_PLAY_TIME,
      resumeMode: 'history',
    });
    expect(playerUrls()).toEqual(
      new Set([resumed.episodes[RESUME_EPISODE_INDEX]]),
    );
    expect(requestCount('/api/playrecords')).toBe(1);
  });

  it('没有播放记录时历史恢复一结束就从第 1 集起播，不等到上限', async () => {
    installFetch({ '/api/playrecords': reply({}) });

    openPlayPage({ singleSource: 'true' }, [resumed]);
    await flushStartup();

    expect(startupFrame()).toMatchObject({
      videoUrl: resumed.episodes[0],
      episodeIndex: 0,
      resumeTime: null,
    });
    expect(requestCount('/api/playrecords')).toBe(1);
  });

  it('播放记录接口一直不返回时到上限才放行，从第 1 集起播', async () => {
    installFetch({ '/api/playrecords': () => new Promise(() => undefined) });

    openPlayPage({ singleSource: 'true' }, [resumed]);
    await flushStartup();
    await advanceTime(999);
    expect(released()).toBe(false);

    await advanceTime(1);
    expect(startupFrame()).toMatchObject({
      videoUrl: resumed.episodes[0],
      episodeIndex: 0,
      resumeTime: null,
    });
  });

  it('播放记录接口失败时立即放行，从第 1 集起播', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    installFetch({ '/api/playrecords': reply({ error: '失败' }, 500) });

    openPlayPage({ singleSource: 'true' }, [resumed]);
    await flushStartup();

    expect(startupFrame()).toMatchObject({
      videoUrl: resumed.episodes[0],
      episodeIndex: 0,
      resumeTime: null,
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe('带源和 id 直接进入', () => {
    beforeEach(() => {
      installFetch({
        '/api/detail': reply(resumed),
        '/api/search': reply({ results: [] }),
        '/api/playrecords': reply(createPlayRecords(resumed)),
      });
    });

    it('带播放意图时按意图的集和时间起播，不读取播放记录', async () => {
      savePlayIntent({
        source: resumed.source,
        id: resumed.id,
        episodeIndex: RESUME_EPISODE_INDEX,
        resumeTime: 300,
      });

      openPlayPage({ source: resumed.source, id: resumed.id });
      await flushStartup();

      expect(startupFrame()).toMatchObject({
        videoUrl: resumed.episodes[RESUME_EPISODE_INDEX],
        episodeIndex: RESUME_EPISODE_INDEX,
        resumeTime: 300,
        resumeMode: 'forced',
      });
      expect(playerUrls()).toEqual(
        new Set([resumed.episodes[RESUME_EPISODE_INDEX]]),
      );
      expect(requestCount('/api/playrecords')).toBe(0);
    });

    it('没有播放意图时读取一次播放记录，按记录的集和时间起播', async () => {
      openPlayPage({ source: resumed.source, id: resumed.id });
      await flushStartup();

      expect(startupFrame()).toMatchObject({
        videoUrl: resumed.episodes[RESUME_EPISODE_INDEX],
        episodeIndex: RESUME_EPISODE_INDEX,
        resumeTime: RECORD_PLAY_TIME,
        resumeMode: 'history',
      });
      expect(playerUrls()).toEqual(
        new Set([resumed.episodes[RESUME_EPISODE_INDEX]]),
      );
      expect(requestCount('/api/playrecords')).toBe(1);
    });
  });
});

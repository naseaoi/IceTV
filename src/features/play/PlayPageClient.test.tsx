import { act, render } from '@testing-library/react';
import type Artplayer from 'artplayer';
import type { ComponentProps, ReactNode } from 'react';

import type { PlayMainContent } from '@/features/play/components/PlayMainContent';
import type { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import type {
  updateVideoUrl,
  usePlayInit,
} from '@/features/play/hooks/usePlayInit';
import type { usePlayProgress } from '@/features/play/hooks/usePlayProgress';
import type { useSourceSwitch } from '@/features/play/hooks/useSourceSwitch';
import { createVodPlaybackIntent } from '@/features/play/lib/vodPlaybackIntent';
import { PlayPageClient } from '@/features/play/PlayPageClient';
import { buildLazyEpisodeUrl } from '@/lib/lazy-episodes';
import type { SearchResult } from '@/lib/types';

type PlayInitParams = Parameters<typeof usePlayInit>[0];
type ArtPlayerParams = Parameters<typeof useArtPlayer>[0];
type SourceSwitchParams = Parameters<typeof useSourceSwitch>[0];
type MainContentProps = ComponentProps<typeof PlayMainContent>;

const mockSearchParams = new URLSearchParams(
  'source=giri&id=giri-id&title=测试剧',
);
const mockSourceSwitch = {
  playbackIntentRef: { current: createVodPlaybackIntent() },
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
const mockUseSourceSwitch = jest.fn<
  typeof mockSourceSwitch,
  [SourceSwitchParams]
>(() => mockSourceSwitch);
const mockUsePlayInit = jest.fn<void, [PlayInitParams]>();
const mockUpdateVideoUrl = jest.fn<void, Parameters<typeof updateVideoUrl>>();
const mockUseArtPlayer = jest.fn<void, [ArtPlayerParams]>();
const mockPlayMainContent = jest.fn<null, [MainContentProps]>(() => null);
const mockPlayProgress = {
  saveCurrentPlayProgress: jest.fn(),
  savePlaybackCheckpoint: jest.fn(),
  requestWakeLock: jest.fn(),
  releaseWakeLock: jest.fn(),
};
const mockUsePlayProgress = jest.fn<
  typeof mockPlayProgress,
  [Parameters<typeof usePlayProgress>[0]]
>(() => mockPlayProgress);
const mockPlaybackStatsReporter = {
  startPlaybackStatsSession: jest.fn(),
  reportPlaybackStats: jest.fn(),
  handlePlaybackStatsEvent: jest.fn(),
};
const mockPlaybackStatsRecorder = {
  recordPlaybackStarted: jest.fn(),
  recordPlaybackFailed: jest.fn(),
};
const mockEpisodeSwitch = {
  handleEpisodeChange: jest.fn(),
  handlePreviousEpisode: jest.fn(),
  handleNextEpisode: jest.fn(),
};
const mockDanmakuPreference = {
  enabledRef: { current: false },
  onEnabledChange: jest.fn(),
};
const mockPeekResolvedLazyEpisodeUrl = jest.fn<string | null, [string, string]>(
  () => null,
);
const mockPendingLazyResolutions = new Map<
  string,
  { resolve: (url: string) => void; reject: (error: unknown) => void }
>();
const mockResolveLazyEpisodeUrl = jest.fn(
  (_source: string, lazyUrl: string) =>
    new Promise<string>((resolve, reject) => {
      mockPendingLazyResolutions.set(lazyUrl, { resolve, reject });
    }),
);
const mockCancelNextEpisodePreload = jest.fn();
const mockClearFragmentMemoryCache = jest.fn();
const mockGetVodRuntimeSourceUrl = jest.fn<string | null, [HTMLVideoElement]>(
  () => null,
);

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/components/AuthenticatedRoute', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/features/play/components/PlayMainContent', () => ({
  PlayMainContent: (props: MainContentProps) => mockPlayMainContent(props),
}));

jest.mock('@/features/play/components/PlayStateViews', () => ({
  PlayErrorView: () => null,
  PlayLoadingView: () => null,
}));

jest.mock('@/features/play/hooks/useArtPlayer', () => ({
  useArtPlayer: (params: ArtPlayerParams) => mockUseArtPlayer(params),
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
  useDanmakuPreference: () => mockDanmakuPreference,
}));

jest.mock('@/features/play/hooks/useDanmakuWarmup', () => ({
  useDanmakuWarmup: jest.fn(),
}));

jest.mock('@/features/play/hooks/useEpisodeSwitch', () => ({
  useEpisodeSwitch: () => mockEpisodeSwitch,
}));

jest.mock('@/features/play/hooks/usePlayFavorite', () => ({
  usePlayFavorite: () => ({ handleToggleFavorite: jest.fn() }),
}));

jest.mock('@/features/play/hooks/usePlayInit', () => ({
  updateVideoUrl: (...args: Parameters<typeof updateVideoUrl>) =>
    mockUpdateVideoUrl(...args),
  usePlayInit: (params: PlayInitParams) => mockUsePlayInit(params),
}));

jest.mock('@/features/play/hooks/usePlayProgress', () => ({
  usePlayProgress: (params: Parameters<typeof usePlayProgress>[0]) =>
    mockUsePlayProgress(params),
}));

jest.mock('@/features/play/hooks/useSkipConfig', () => ({
  useSkipConfig: () => ({ handleSkipConfigChange: jest.fn() }),
}));

jest.mock('@/features/play/hooks/useSourcePlaybackStatsRecorder', () => ({
  useSourcePlaybackStatsRecorder: () => mockPlaybackStatsRecorder,
}));

jest.mock('@/features/play/hooks/useSourceSwitch', () => ({
  useSourceSwitch: (params: SourceSwitchParams) => mockUseSourceSwitch(params),
}));

jest.mock('@/features/play/lib/danmaku/attach', () => ({
  applyDanmakuHeatmapVisibility: jest.fn(),
  ensureDanmakuLoaded: jest.fn(),
  reloadDanmaku: jest.fn(),
}));

jest.mock('@/features/play/lib/fragmentMemoryCache', () => ({
  fragmentMemoryCache: { clear: () => mockClearFragmentMemoryCache() },
}));

jest.mock('@/features/play/lib/lazyEpisode', () => ({
  peekResolvedLazyEpisodeUrl: (source: string, lazyUrl: string) =>
    mockPeekResolvedLazyEpisodeUrl(source, lazyUrl),
  prewarmLazyEpisodeUrl: jest.fn(),
  resolveLazyEpisodeUrl: (source: string, lazyUrl: string) =>
    mockResolveLazyEpisodeUrl(source, lazyUrl),
}));

jest.mock('@/features/play/lib/nextEpisodePreload', () => ({
  cancelNextEpisodePreload: () => mockCancelNextEpisodePreload(),
}));

jest.mock('@/features/play/lib/sourceProbeStore', () => ({
  writePlayerInfo: jest.fn(),
}));

jest.mock('@/features/play/lib/vodHlsRuntime', () => ({
  getVodRuntimeSourceUrl: (video: HTMLVideoElement) =>
    mockGetVodRuntimeSourceUrl(video),
}));

jest.mock('@/features/playback-stats/hooks/usePlaybackStatsReporter', () => ({
  usePlaybackStatsReporter: () => mockPlaybackStatsReporter,
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
  runManagedVideoCleanup: jest.fn(),
}));

jest.mock('@/lib/proxy-modes', () => ({
  preloadProxyModes: jest.fn(),
}));

const LAZY_EPISODES = [1, 2, 3].map((episode) =>
  buildLazyEpisodeUrl('giri', `/playGV100-1-${episode}/`),
);

const LAZY_DETAIL: SearchResult = {
  id: 'giri-id',
  title: '测试剧',
  poster: '',
  episodes: LAZY_EPISODES,
  episodes_titles: ['第1集', '第2集', '第3集'],
  source: 'giri',
  source_name: 'Giri',
  year: '2024',
};

function lastArg<T>(mock: jest.Mock<unknown, [T]>): T {
  const { calls } = mock.mock;
  return calls[calls.length - 1][0];
}

const latestPlayInit = () => lastArg(mockUsePlayInit);
const latestSourceSwitch = () => lastArg(mockUseSourceSwitch);
const latestVideoUrl = () => lastArg(mockUseArtPlayer).videoUrl;

function renderLoadedPage() {
  const view = render(<PlayPageClient />);
  act(() => {
    latestPlayInit().setDetail(LAZY_DETAIL);
    latestPlayInit().setLoading(false);
  });
  return view;
}

function switchToEpisode(index: number) {
  act(() => {
    latestPlayInit().setCurrentEpisodeIndex(index);
  });
}

async function settleLazyEpisode(lazyUrl: string, resolvedUrl: string | null) {
  const pending = mockPendingLazyResolutions.get(lazyUrl);
  await act(async () => {
    if (resolvedUrl) {
      pending?.resolve(resolvedUrl);
    } else {
      pending?.reject(new Error('解析失败'));
    }
  });
}

describe('PlayPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSourceSwitch.playbackIntentRef.current = createVodPlaybackIntent();
    mockPendingLazyResolutions.clear();
    mockPeekResolvedLazyEpisodeUrl.mockImplementation(() => null);
    mockGetVodRuntimeSourceUrl.mockImplementation(() => null);
    sessionStorage.clear();
  });

  it('历史恢复换集回调同步重置意图，换源提交索引不触发通用重置', () => {
    renderLoadedPage();
    const restore = lastArg(mockUsePlayProgress);
    act(() => restore.onRestoreEpisodeChange?.());
    expect(mockSourceSwitch.resetAutoSourceSwitch).toHaveBeenCalledTimes(1);
    act(() => latestSourceSwitch().setCurrentEpisodeIndex(1));
    expect(mockSourceSwitch.resetAutoSourceSwitch).toHaveBeenCalledTimes(1);
  });

  it('普通详情等待不创建预算，懒解析开始登记源尝试且解析完成保留起点', async () => {
    const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
    render(<PlayPageClient />);
    act(() => latestPlayInit().setDetail(LAZY_DETAIL));
    expect(mockSourceSwitch.playbackIntentRef.current.activeSource).toBeNull();
    clock.mockReturnValue(50_000);
    act(() => latestPlayInit().setLoading(false));
    const attempt = mockSourceSwitch.playbackIntentRef.current.activeSource;
    expect(attempt?.source).toBe('giri');
    expect(attempt?.startedAt).toBe(50_000);
    clock.mockReturnValue(55_000);
    await settleLazyEpisode(LAZY_EPISODES[0], 'https://cdn.example/ep1.m3u8');
    expect(mockSourceSwitch.playbackIntentRef.current.activeSource).toBe(
      attempt,
    );
    expect(attempt?.startedAt).toBe(50_000);
    clock.mockRestore();
  });

  describe('起播放行前不派生播放地址', () => {
    // 模拟起播提交详情后历史恢复改到第 3 集，起播随后才放行
    function renderRestoredBeforeRelease(detail: SearchResult) {
      render(<PlayPageClient />);
      act(() => {
        latestPlayInit().setDetail(detail);
      });
      act(() => {
        latestPlayInit().setCurrentEpisodeIndex(2);
      });
    }

    function releaseStartup() {
      act(() => {
        latestPlayInit().setLoading(false);
      });
    }

    it('放行前不派生地址，放行后只按历史恢复定下的集派生', () => {
      const episodeUrls = [1, 2, 3].map(
        (episode) => `https://cdn.example/${episode}.m3u8`,
      );
      renderRestoredBeforeRelease({ ...LAZY_DETAIL, episodes: episodeUrls });
      expect(mockUpdateVideoUrl).not.toHaveBeenCalled();

      releaseStartup();

      const derivedIndexes = mockUpdateVideoUrl.mock.calls.map(
        ([, episodeIndex]) => episodeIndex,
      );
      expect(derivedIndexes.length).toBeGreaterThan(0);
      expect(new Set(derivedIndexes)).toEqual(new Set([2]));
    });

    it('逐集解析型源放行前不解析，放行后只解析历史恢复定下的集', async () => {
      renderRestoredBeforeRelease(LAZY_DETAIL);
      expect(mockResolveLazyEpisodeUrl).not.toHaveBeenCalled();

      releaseStartup();

      expect(
        mockResolveLazyEpisodeUrl.mock.calls.map(([, lazyUrl]) => lazyUrl),
      ).toEqual([LAZY_EPISODES[2]]);
      await settleLazyEpisode(LAZY_EPISODES[2], 'https://cdn.example/3.m3u8');
      expect(latestVideoUrl()).toBe('https://cdn.example/3.m3u8');
    });
  });

  it('逐集解析换到未缓存的集时停掉上一集的运行时并清空地址，解析后换上新地址', async () => {
    renderLoadedPage();
    await settleLazyEpisode(LAZY_EPISODES[0], 'https://cdn.example/1.m3u8');
    expect(latestVideoUrl()).toBe('https://cdn.example/1.m3u8');
    mockSourceSwitch.stopActiveHlsLoading.mockClear();

    switchToEpisode(1);
    expect(mockSourceSwitch.stopActiveHlsLoading).toHaveBeenCalledTimes(1);
    expect(latestVideoUrl()).toBe('');

    await settleLazyEpisode(LAZY_EPISODES[1], 'https://cdn.example/2.m3u8');
    expect(latestVideoUrl()).toBe('https://cdn.example/2.m3u8');
    expect(mockSourceSwitch.stopActiveHlsLoading).toHaveBeenCalledTimes(1);
  });

  it('命中解析缓存的集直接换上新地址，不停运行时也不清空', async () => {
    mockPeekResolvedLazyEpisodeUrl.mockImplementation((_source, lazyUrl) =>
      lazyUrl === LAZY_EPISODES[2] ? 'https://cdn.example/3.m3u8' : null,
    );
    renderLoadedPage();
    await settleLazyEpisode(LAZY_EPISODES[0], 'https://cdn.example/1.m3u8');
    mockSourceSwitch.stopActiveHlsLoading.mockClear();
    const renderedBefore = mockUseArtPlayer.mock.calls.length;

    switchToEpisode(2);

    expect(mockSourceSwitch.stopActiveHlsLoading).not.toHaveBeenCalled();
    expect(latestVideoUrl()).toBe('https://cdn.example/3.m3u8');
    const renderedUrls = mockUseArtPlayer.mock.calls
      .slice(renderedBefore)
      .map(([params]) => params.videoUrl);
    expect(renderedUrls).not.toContain('');
  });

  it('换源开始后作废进行中的逐集解析，解析结果和失败都不再落到页面', async () => {
    renderLoadedPage();
    const { sourceChangeRequestIdRef } = latestSourceSwitch();

    sourceChangeRequestIdRef.current += 1;
    await settleLazyEpisode(LAZY_EPISODES[0], 'https://cdn.example/1.m3u8');
    expect(latestVideoUrl()).toBe('');

    switchToEpisode(1);
    sourceChangeRequestIdRef.current += 1;
    await settleLazyEpisode(LAZY_EPISODES[1], null);
    expect(
      mockSourceSwitch.handleEpisodeUrlResolveFailed,
    ).not.toHaveBeenCalled();

    // 没有换源介入时解析失败照常交给换源逻辑
    switchToEpisode(2);
    await settleLazyEpisode(LAZY_EPISODES[2], null);
    expect(
      mockSourceSwitch.handleEpisodeUrlResolveFailed,
    ).toHaveBeenCalledTimes(1);
  });

  it('点击当前集与越界选集保留当前播放意图', () => {
    renderLoadedPage();
    const choose = (index: number) =>
      act(() => lastArg(mockPlayMainContent).onEpisodeChange(index));
    choose(0);
    choose(-1);
    choose(999);
    expect(mockSourceSwitch.resetAutoSourceSwitch).not.toHaveBeenCalled();
    mockEpisodeSwitch.handleEpisodeChange.mockImplementationOnce(() => {
      latestSourceSwitch().currentEpisodeIndexRef.current = 1;
    });
    choose(1);
    expect(mockSourceSwitch.resetAutoSourceSwitch).toHaveBeenCalledTimes(1);
  });

  it('重试按当前进度重新拉起，不再按换集清空进度；起播后补显示暂存提示', () => {
    renderLoadedPage();
    const { clearTargetEpisodeProgressRef, stableCurrentTimeRef } =
      latestSourceSwitch();
    stableCurrentTimeRef.current = 95;

    act(() => {
      lastArg(mockPlayMainContent).onRetryPlayback();
    });

    expect(mockSourceSwitch.resetAutoSourceSwitch).toHaveBeenCalledTimes(1);
    expect(mockSourceSwitch.restartCurrentPlayback).toHaveBeenCalledTimes(1);
    expect(clearTargetEpisodeProgressRef.current).toBe(false);
    expect(stableCurrentTimeRef.current).toBe(95);
    expect(latestSourceSwitch().playbackRequestModeRef.current).toBe('episode');

    act(() => {
      lastArg(mockUseArtPlayer).onPlaybackStarted?.();
    });
    expect(mockSourceSwitch.showPendingPlaybackNotice).toHaveBeenCalledTimes(1);
  });

  describe('起播统计', () => {
    const EPISODE_1_URL = 'https://cdn.example/1.m3u8';

    async function renderPlayingFirstEpisode() {
      renderLoadedPage();
      await settleLazyEpisode(LAZY_EPISODES[0], EPISODE_1_URL);
      const video = document.createElement('video');
      lastArg(mockUseArtPlayer).artPlayerRef.current = {
        video,
      } as unknown as Artplayer;
      return video;
    }

    function notifyPlaybackStarted() {
      act(() => {
        lastArg(mockUseArtPlayer).onPlaybackStarted?.();
      });
    }

    it('播放器上登记的运行时就是当前地址时才记为该源起播成功', async () => {
      const video = await renderPlayingFirstEpisode();
      mockGetVodRuntimeSourceUrl.mockImplementation((target) =>
        target === video ? EPISODE_1_URL : null,
      );

      notifyPlaybackStarted();

      expect(
        mockPlaybackStatsRecorder.recordPlaybackStarted,
      ).toHaveBeenCalledTimes(1);
    });

    it('运行时已释放或登记的是别的地址时起播不计入统计，其余起播处理照常', async () => {
      await renderPlayingFirstEpisode();

      notifyPlaybackStarted();
      mockGetVodRuntimeSourceUrl.mockImplementation(
        () => 'https://cdn.example/0.m3u8',
      );
      notifyPlaybackStarted();

      expect(
        mockPlaybackStatsRecorder.recordPlaybackStarted,
      ).not.toHaveBeenCalled();
      expect(mockSourceSwitch.showPendingPlaybackNotice).toHaveBeenCalledTimes(
        2,
      );
    });

    it('逐集解析等待新地址期间，上一集运行时的起播不计入新集统计', async () => {
      const video = await renderPlayingFirstEpisode();
      mockGetVodRuntimeSourceUrl.mockImplementation((target) =>
        target === video ? EPISODE_1_URL : null,
      );

      switchToEpisode(1);
      expect(latestVideoUrl()).toBe('');
      notifyPlaybackStarted();

      expect(
        mockPlaybackStatsRecorder.recordPlaybackStarted,
      ).not.toHaveBeenCalled();
    });

    it('当前地址真实起播后才登记当前源已起播，供后台测速跳过', async () => {
      const video = await renderPlayingFirstEpisode();
      const { playbackStartedSourceRef } = latestPlayInit();

      notifyPlaybackStarted();
      expect(playbackStartedSourceRef.current).toBeNull();

      mockGetVodRuntimeSourceUrl.mockImplementation((target) =>
        target === video ? EPISODE_1_URL : null,
      );
      notifyPlaybackStarted();
      expect(playbackStartedSourceRef.current).toEqual({
        source: LAZY_DETAIL.source,
        id: LAZY_DETAIL.id,
      });
    });
  });

  it('离开播放页才取消下一集预载并清空分片缓存，页面内换集和重渲染不释放', () => {
    const { rerender, unmount } = renderLoadedPage();
    switchToEpisode(1);
    rerender(<PlayPageClient />);

    expect(mockCancelNextEpisodePreload).not.toHaveBeenCalled();
    expect(mockClearFragmentMemoryCache).not.toHaveBeenCalled();

    unmount();

    expect(mockCancelNextEpisodePreload).toHaveBeenCalledTimes(1);
    expect(mockClearFragmentMemoryCache).toHaveBeenCalledTimes(1);
  });

  it('清理播放器时先退出网页全屏再销毁', () => {
    renderLoadedPage();
    const { artPlayerRef, cleanupPlayer } = lastArg(mockUseArtPlayer);
    const player = { fullscreenWeb: true, destroy: jest.fn() };
    const fullscreenWebOnDestroy: boolean[] = [];
    player.destroy.mockImplementation(() => {
      fullscreenWebOnDestroy.push(player.fullscreenWeb);
    });
    artPlayerRef.current = player as unknown as Artplayer;

    act(() => {
      cleanupPlayer();
    });

    expect(fullscreenWebOnDestroy).toEqual([false]);
    expect(artPlayerRef.current).toBeNull();
  });
});

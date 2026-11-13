import {
  AlertTriangle,
  ArrowLeftRight,
  LockKeyhole,
  RefreshCw,
} from 'lucide-react';
import { RefObject, useEffect, useRef, useState } from 'react';

import { PlayerPageLayout } from '@/components/PlayerPageLayout';
import PlayerStateOverlay, {
  PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS,
  PLAYER_OVERLAY_SECONDARY_BUTTON_CLASS,
} from '@/components/PlayerStateOverlay';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import EpisodeSelector from '@/features/play/components/EpisodeSelector';
import type {
  SourceRecommendation,
  VideoLoadingStage,
} from '@/features/play/hooks/usePlayPageState';
import type { DanmakuReloadHandler } from '@/features/play/lib/danmaku/types';
import {
  type VodStartupProgress,
  describeVodStartupState,
  getVodStartupNow,
  getVodStartupProgress,
} from '@/features/play/lib/playerLoading';
import type { VodPlaybackIntent } from '@/features/play/lib/vodPlaybackIntent';
import {
  resolveVodStartupTimeouts,
  VOD_STARTUP_PROGRESS_POLL_MS,
} from '@/features/play/lib/vodSourcePlaybackPolicy';
import { SearchResult } from '@/lib/types';

interface PlayMainContentProps {
  videoTitle: string;
  totalEpisodes: number;
  detail: SearchResult | null;
  detailLoading: boolean;
  currentEpisodeIndex: number;
  isEpisodeSelectorCollapsed: boolean;
  setIsEpisodeSelectorCollapsed: (collapsed: boolean) => void;
  artRef: RefObject<HTMLDivElement | null>;
  isVideoLoading: boolean;
  videoLoadingStage: VideoLoadingStage;
  videoLoadingAttempt: number;
  realtimeLoadSpeed: string;
  authRecoveryVisible: boolean;
  authRecoveryReasonMessage: string;
  onReloginAndRecover: () => void;
  onDismissAuthRecovery: () => void;
  onEpisodeChange: (episodeNumber: number) => void;
  onRetryPlayback: () => void;
  onOpenSources: () => void;
  openSourcesRequest: number;
  onSourceChange: (newSource: string, newId: string, newTitle: string) => void;
  currentSource: string;
  currentId: string;
  searchTitle: string;
  availableSources: SearchResult[];
  sourceSearchLoading: boolean;
  sourceSearchError: string | null;
  precomputedVideoInfo: Map<
    string,
    { quality: string; loadSpeed: string; pingTime: number }
  >;
  sourceRecommendation?: SourceRecommendation | null;
  onDismissSourceRecommendation?: () => void;
  videoYear: string;
  favorited: boolean;
  onToggleFavorite: () => void;
  videoCover: string;
  videoDoubanId: number;
  onSourceDetailFetched?: (updated: SearchResult) => void;
  onAddSources?: (newSources: SearchResult[]) => void;
  onDanmakuReload?: DanmakuReloadHandler;
  onDanmakuHeatmapChange?: (enabled: boolean) => void;
  // 返回 true 表示已切换线路或自动换源，继续显示加载而不进入超时状态
  onLoadingTimeout?: () => boolean | void;
  playbackError?: string | null;
  playbackIntentRef?: RefObject<VodPlaybackIntent>;
}

const SOURCE_RECOMMENDATION_AUTO_DISMISS_MS = 5000;

export function buildLoadingTimeoutMessage(
  timeoutSeconds: number,
  totalLimit = false,
): string {
  return totalLimit
    ? `媒体加载已达 ${timeoutSeconds} 秒，仍未能起播`
    : `媒体加载已连续 ${timeoutSeconds} 秒无进展，源站响应超时`;
}

const LOADING_STAGE_CONFIG: Record<
  VideoLoadingStage,
  { title: string; timeoutTitle: string }
> = {
  initing: { title: '正在加载视频', timeoutTitle: '加载视频超时' },
  sourceChanging: { title: '正在切换源站', timeoutTitle: '切换播放源超时' },
  episodeChanging: { title: '正在切换剧集', timeoutTitle: '切换剧集超时' },
};

function RetryPlaybackButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type='button'
      onClick={onRetry}
      className={PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS}
    >
      <RefreshCw className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
      <span>继续尝试</span>
    </button>
  );
}

function OpenSourcesButton({ onOpenSources }: { onOpenSources: () => void }) {
  return (
    <button
      type='button'
      onClick={onOpenSources}
      className={PLAYER_OVERLAY_SECONDARY_BUTTON_CLASS}
    >
      <ArrowLeftRight className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
      <span>选择其他源</span>
    </button>
  );
}

function PlayLoadingOverlay({
  visible,
  loadingTimedOut,
  videoLoadingStage,
  realtimeLoadSpeed,
  timeoutSeconds,
  totalLimit,
  onRetry,
  onOpenSources,
}: {
  visible: boolean;
  loadingTimedOut: boolean;
  videoLoadingStage: VideoLoadingStage;
  realtimeLoadSpeed: string;
  timeoutSeconds: number;
  totalLimit: boolean;
  onRetry: () => void;
  onOpenSources: () => void;
}) {
  const stageConfig = LOADING_STAGE_CONFIG[videoLoadingStage];

  if (loadingTimedOut) {
    return (
      <PlayerStateOverlay
        visible={visible}
        zClassName='z-[500]'
        icon={<AlertTriangle />}
        title={stageConfig.timeoutTitle}
        message={buildLoadingTimeoutMessage(timeoutSeconds, totalLimit)}
      >
        <RetryPlaybackButton onRetry={onRetry} />
        <OpenSourcesButton onOpenSources={onOpenSources} />
      </PlayerStateOverlay>
    );
  }

  // 状态文案与标题重复时（如「正在切换剧集...」）不再显示第二行
  const detail =
    realtimeLoadSpeed &&
    realtimeLoadSpeed.replace(/[.…]+$/, '') !== stageConfig.title
      ? realtimeLoadSpeed
      : undefined;

  return (
    <PlayerStateOverlay
      visible={visible}
      zClassName='z-[500]'
      loading
      title={stageConfig.title}
      message={detail}
    />
  );
}

function PlaybackErrorOverlay({
  message,
  onRetry,
  onOpenSources,
}: {
  message: string;
  onRetry: () => void;
  onOpenSources: () => void;
}) {
  return (
    <PlayerStateOverlay
      zClassName='z-[510]'
      icon={<AlertTriangle />}
      title={message}
    >
      <RetryPlaybackButton onRetry={onRetry} />
      <OpenSourcesButton onOpenSources={onOpenSources} />
    </PlayerStateOverlay>
  );
}

function AuthRecoveryOverlay({
  message,
  onReloginAndRecover,
  onDismissAuthRecovery,
}: {
  message: string;
  onReloginAndRecover: () => void;
  onDismissAuthRecovery: () => void;
}) {
  return (
    <PlayerStateOverlay
      zClassName='z-[520]'
      icon={<LockKeyhole />}
      tone='neutral'
      title='登录状态异常'
      message={message}
    >
      <button
        type='button'
        onClick={onReloginAndRecover}
        className={PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS}
      >
        去登录并恢复播放
      </button>
      <button
        type='button'
        onClick={onDismissAuthRecovery}
        className={PLAYER_OVERLAY_SECONDARY_BUTTON_CLASS}
      >
        稍后处理
      </button>
    </PlayerStateOverlay>
  );
}

export function PlayMainContent(props: PlayMainContentProps) {
  const {
    videoTitle,
    totalEpisodes,
    detail,
    detailLoading,
    currentEpisodeIndex,
    isEpisodeSelectorCollapsed,
    setIsEpisodeSelectorCollapsed,
    artRef,
    isVideoLoading,
    videoLoadingStage,
    videoLoadingAttempt,
    authRecoveryVisible,
    authRecoveryReasonMessage,
    onReloginAndRecover,
    onDismissAuthRecovery,
    onEpisodeChange,
    onRetryPlayback,
    onOpenSources,
    openSourcesRequest,
    onSourceChange,
    currentSource,
    currentId,
    searchTitle,
    availableSources,
    sourceSearchLoading,
    sourceSearchError,
    precomputedVideoInfo,
    sourceRecommendation,
    onDismissSourceRecommendation,
    videoYear,
    favorited,
    onToggleFavorite,
    videoCover,
    videoDoubanId,
    onSourceDetailFetched,
    onAddSources,
    onDanmakuReload,
    onDanmakuHeatmapChange,
    onLoadingTimeout,
    realtimeLoadSpeed,
    playbackError,
    playbackIntentRef,
  } = props;

  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [totalLimitReached, setTotalLimitReached] = useState(false);
  const runtimeConfig = useRuntimeConfig();
  const { idleMs: loadingTimeoutMs, totalMs: totalLoadingTimeoutMs } =
    resolveVodStartupTimeouts(
      currentSource,
      runtimeConfig.VOD_PAGE_TIMEOUT_SECONDS,
      runtimeConfig.VOD_FRAGMENT_TIMEOUT_SECONDS,
    );
  const settledStartupProgressRef = useRef<VodStartupProgress | null>(null);
  const onLoadingTimeoutRef = useRef(onLoadingTimeout);
  const onDismissSourceRecommendationRef = useRef(
    onDismissSourceRecommendation,
  );
  const loadingStatusText = realtimeLoadSpeed;

  useEffect(() => {
    onLoadingTimeoutRef.current = onLoadingTimeout;
  }, [onLoadingTimeout]);

  useEffect(() => {
    onDismissSourceRecommendationRef.current = onDismissSourceRecommendation;
  }, [onDismissSourceRecommendation]);

  useEffect(() => {
    if (!isVideoLoading || playbackError) {
      // 换集、重试后到新运行时登记进度前，video 上仍挂着上一轮的进度，按它计时会把已播时长算成起播耗时
      const video = artRef.current?.querySelector('video');
      settledStartupProgressRef.current = video
        ? getVodStartupProgress(video)
        : null;
      setLoadingTimedOut(false);
      return;
    }
    setLoadingTimedOut(false);
    setTotalLimitReached(false);
    // 无运行时的准备阶段用一个无进展窗口兜底；已登记的源尝试同时受总预算约束。
    const effectStartedAt = getVodStartupNow();
    const fallbackProgress = {
      sourceKey: '',
      startedAt: effectStartedAt,
      lastProgressAt: effectStartedAt,
    };
    let expiredProgress: ReturnType<typeof getVodStartupProgress> = null;
    const intent = playbackIntentRef?.current;
    const timer = setInterval(() => {
      if (intent !== playbackIntentRef?.current || document.hidden) return;
      const video = artRef.current?.querySelector('video');
      const runtimeProgress = video ? getVodStartupProgress(video) : null;
      const attempt = playbackIntentRef?.current.activeSource;
      const attemptTimeouts = resolveVodStartupTimeouts(
        attempt?.source || currentSource,
        runtimeConfig.VOD_PAGE_TIMEOUT_SECONDS,
        runtimeConfig.VOD_FRAGMENT_TIMEOUT_SECONDS,
      );
      const progress =
        runtimeProgress &&
        runtimeProgress !== settledStartupProgressRef.current &&
        (!runtimeProgress.sourceKey ||
          runtimeProgress.sourceKey === currentSource)
          ? runtimeProgress
          : fallbackProgress;
      if (progress === expiredProgress) return;
      const startedAt = attempt?.startedAt ?? progress.startedAt;
      // 首条线路最多占用总预算减去一个窗口，保证回落仍有完整的无进展窗口。
      const totalBudget =
        attemptTimeouts.totalMs -
        (attempt?.allowAutoFallback && !attempt.routeSwitched
          ? attemptTimeouts.idleMs
          : 0);
      const now = getVodStartupNow();
      const totalLimit = now - startedAt >= totalBudget;
      if (!totalLimit && now - progress.lastProgressAt < attemptTimeouts.idleMs)
        return;
      expiredProgress = progress;
      console.warn('点播起播超时', {
        totalLimit,
        progressSource:
          progress === fallbackProgress ? 'fallback' : 'media-runtime',
        elapsedMs: Math.round(now - progress.startedAt),
        idleMs: Math.round(now - progress.lastProgressAt),
        videoLoadingStage,
        ...describeVodStartupState(video),
      });
      if (onLoadingTimeoutRef.current?.() === true) {
        return;
      }
      setTotalLimitReached(totalLimit);
      setLoadingTimedOut(true);
    }, VOD_STARTUP_PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [
    artRef,
    currentSource,
    isVideoLoading,
    videoLoadingStage,
    videoLoadingAttempt,
    playbackError,
    loadingTimeoutMs,
    totalLoadingTimeoutMs,
    playbackIntentRef,
    runtimeConfig.VOD_PAGE_TIMEOUT_SECONDS,
    runtimeConfig.VOD_FRAGMENT_TIMEOUT_SECONDS,
  ]);

  useEffect(() => {
    if (!sourceRecommendation || playbackError) return;
    const timer = window.setTimeout(() => {
      onDismissSourceRecommendationRef.current?.();
    }, SOURCE_RECOMMENDATION_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timer);
  }, [sourceRecommendation, playbackError]);

  return (
    <PlayerPageLayout
      activePath='/play'
      title={videoTitle}
      titleFallback='影片标题'
      isPanelCollapsed={isEpisodeSelectorCollapsed}
      onTogglePanel={() =>
        setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
      }
      artRef={artRef}
      titleSuffix={
        totalEpisodes > 1
          ? detail?.episodes_titles?.[currentEpisodeIndex] ||
            `第 ${currentEpisodeIndex + 1} 集`
          : null
      }
      mobilePanelAlwaysVisible
      playerOverlay={
        <>
          <PlayLoadingOverlay
            visible={isVideoLoading && !playbackError}
            loadingTimedOut={loadingTimedOut}
            videoLoadingStage={videoLoadingStage}
            realtimeLoadSpeed={loadingStatusText}
            timeoutSeconds={
              (totalLimitReached ? totalLoadingTimeoutMs : loadingTimeoutMs) /
              1000
            }
            totalLimit={totalLimitReached}
            onRetry={onRetryPlayback}
            onOpenSources={onOpenSources}
          />
          {playbackError && (
            <PlaybackErrorOverlay
              message={playbackError}
              onRetry={onRetryPlayback}
              onOpenSources={onOpenSources}
            />
          )}
          {authRecoveryVisible && (
            <AuthRecoveryOverlay
              message={authRecoveryReasonMessage}
              onReloginAndRecover={onReloginAndRecover}
              onDismissAuthRecovery={onDismissAuthRecovery}
            />
          )}
          {sourceRecommendation && !playbackError && (
            <div className='absolute right-3 top-3 z-20 max-w-[min(22rem,calc(100%-1.5rem))] animate-menu-in-down rounded-xl bg-black/80 px-3 py-2 text-xs text-white shadow-lg ring-1 ring-white/10 sm:right-4 sm:top-4'>
              <div className='font-medium'>
                发现更优源：{sourceRecommendation.sourceName}
              </div>
              <div className='mt-0.5 text-white/75'>
                {sourceRecommendation.quality} ·{' '}
                {sourceRecommendation.loadSpeed}
                ，可在换源中手动选择
              </div>
              <button
                type='button'
                className='mt-1 text-brand-300 hover:text-brand-200'
                onClick={() => onDismissSourceRecommendationRef.current?.()}
              >
                知道了
              </button>
            </div>
          )}
        </>
      }
      rightPanel={
        <EpisodeSelector
          totalEpisodes={totalEpisodes}
          episodes_titles={detail?.episodes_titles || []}
          value={currentEpisodeIndex + 1}
          onChange={onEpisodeChange}
          onSourceChange={onSourceChange}
          currentSource={currentSource}
          currentId={currentId}
          videoTitle={videoTitle}
          searchKeyword={searchTitle}
          availableSources={availableSources}
          sourceSearchLoading={sourceSearchLoading}
          sourceSearchError={sourceSearchError}
          precomputedVideoInfo={precomputedVideoInfo}
          detail={detail}
          detailLoading={detailLoading}
          videoYear={videoYear}
          favorited={favorited}
          onToggleFavorite={onToggleFavorite}
          videoCover={videoCover}
          videoDoubanId={videoDoubanId}
          onSourceDetailFetched={onSourceDetailFetched}
          onAddSources={onAddSources}
          onDanmakuReload={onDanmakuReload}
          onDanmakuHeatmapChange={onDanmakuHeatmapChange}
          openSourcesRequest={openSourcesRequest}
        />
      }
    />
  );
}

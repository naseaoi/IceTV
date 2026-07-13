import { AlertTriangle, Cat, Clover, Film, RefreshCw, Tv } from 'lucide-react';
import {
  ReactNode,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import LoadingStatePanel from '@/components/LoadingStatePanel';
import {
  PlayerPageAccent,
  PlayerPageLayout,
} from '@/components/PlayerPageLayout';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import EpisodeSelector from '@/features/play/components/EpisodeSelector';
import type {
  SourceRecommendation,
  VideoLoadingStage,
} from '@/features/play/hooks/usePlayPageState';
import { SearchResult } from '@/lib/types';

interface PlayMainContentProps {
  videoTitle: string;
  totalEpisodes: number;
  detail: SearchResult | null;
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
  onLoadingTimeout?: () => void;
  searchType?: string;
  playbackError?: string | null;
}

const DEFAULT_PLAYER_LOADING_TIMEOUT_SECONDS = 15;
const SOURCE_RECOMMENDATION_AUTO_DISMISS_MS = 5000;

export function buildLoadingTimeoutMessage(timeoutSeconds: number): string {
  return `已等待超过 ${timeoutSeconds} 秒，源站响应超时`;
}

const playAccents: Record<string, PlayerPageAccent> = {
  film: {
    icon: 'text-blue-500 dark:text-blue-400',
    glow: 'bg-blue-400/10 dark:bg-blue-400/20',
    sub: 'text-blue-600/80 dark:text-blue-400/70',
  },
  tv: {
    icon: 'text-emerald-500 dark:text-emerald-400',
    glow: 'bg-emerald-400/10 dark:bg-emerald-400/20',
    sub: 'text-emerald-600/80 dark:text-emerald-400/70',
  },
  anime: {
    icon: 'text-pink-500 dark:text-pink-400',
    glow: 'bg-pink-400/10 dark:bg-pink-400/20',
    sub: 'text-pink-600/80 dark:text-pink-400/70',
  },
  variety: {
    icon: 'text-violet-500 dark:text-violet-400',
    glow: 'bg-violet-400/10 dark:bg-violet-400/20',
    sub: 'text-violet-600/80 dark:text-violet-400/70',
  },
};

function PlayerOverlayPanel({
  title,
  message,
  description,
  children,
  zClassName,
  icon = <AlertTriangle className='h-6 w-6 sm:h-9 sm:w-9' />,
  tone = 'red',
  glow = false,
}: {
  title: string;
  message?: string;
  description?: string;
  children?: ReactNode;
  zClassName: string;
  icon?: ReactNode;
  tone?: 'emerald' | 'blue' | 'amber' | 'red';
  glow?: boolean;
}) {
  return (
    <div
      className={`absolute inset-0 ${zClassName} flex items-center justify-center overflow-hidden rounded-xl bg-black/85 backdrop-blur-sm transition-all duration-300`}
    >
      <LoadingStatePanel
        compact
        glow={glow}
        icon={icon}
        tone={tone}
        title={title}
        titleClassName='text-base text-white sm:text-2xl'
        message={message}
        messageClassName='mx-auto max-w-[16rem] text-xs leading-5 text-gray-300 sm:max-w-none sm:text-sm sm:leading-6'
        description={description}
        descriptionClassName='text-gray-400'
        className='max-w-[19rem] p-3 sm:max-w-lg sm:p-6'
      >
        {children}
      </LoadingStatePanel>
    </div>
  );
}

const LOADING_STAGE_CONFIG: Record<
  VideoLoadingStage,
  { title: string; status: string; timeoutTitle: string; icon: ReactNode }
> = {
  initing: {
    title: '正在加载视频',
    status: '正在加载视频...',
    timeoutTitle: '加载视频超时',
    icon: <Tv className='h-6 w-6 sm:h-9 sm:w-9' />,
  },
  sourceChanging: {
    title: '正在切换源站',
    status: '正在切换源站...',
    timeoutTitle: '切换播放源超时',
    icon: <RefreshCw className='h-6 w-6 sm:h-9 sm:w-9' />,
  },
  episodeChanging: {
    title: '正在切换剧集',
    status: '正在切换剧集...',
    timeoutTitle: '切换剧集超时',
    icon: <RefreshCw className='h-6 w-6 sm:h-9 sm:w-9' />,
  },
};

function PlayLoadingOverlay({
  loadingTimedOut,
  videoLoadingStage,
  realtimeLoadSpeed,
  timeoutSeconds,
}: {
  loadingTimedOut: boolean;
  videoLoadingStage: VideoLoadingStage;
  realtimeLoadSpeed: string;
  timeoutSeconds: number;
}) {
  const stageConfig = LOADING_STAGE_CONFIG[videoLoadingStage];
  const statusText = realtimeLoadSpeed || stageConfig.status;

  if (loadingTimedOut) {
    return (
      <PlayerOverlayPanel
        zClassName='z-[500]'
        title={stageConfig.timeoutTitle}
        message={buildLoadingTimeoutMessage(timeoutSeconds)}
      />
    );
  }

  return (
    <PlayerOverlayPanel
      zClassName='z-[500]'
      tone='blue'
      glow
      icon={stageConfig.icon}
      title={stageConfig.title}
      message={statusText}
    />
  );
}

function PlaybackErrorOverlay({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <PlayerOverlayPanel
      zClassName='z-[510]'
      title={message}
      message='请从右侧面板手动切换其他源站。'
    >
      <button
        type='button'
        onClick={onRetry}
        className='mx-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70'
      >
        <RefreshCw className='h-4 w-4' />
        <span>继续尝试</span>
      </button>
    </PlayerOverlayPanel>
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
    <div className='absolute inset-0 z-[520] flex items-center justify-center rounded-xl bg-black/80 backdrop-blur-sm'>
      <div className='mx-4 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900/95 p-6 text-center shadow-2xl'>
        <div className='mb-3 text-4xl'>🔐</div>
        <h3 className='mb-2 text-lg font-semibold text-white'>登录状态异常</h3>
        <p className='mb-5 text-sm leading-6 text-zinc-300'>{message}</p>
        <div className='space-y-2'>
          <button
            onClick={onReloginAndRecover}
            className='w-full rounded-lg bg-green-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-green-500'
          >
            去登录并恢复播放
          </button>
          <button
            onClick={onDismissAuthRecovery}
            className='w-full rounded-lg bg-zinc-700 px-4 py-2.5 font-medium text-zinc-200 transition-colors hover:bg-zinc-600'
          >
            稍后处理
          </button>
        </div>
      </div>
    </div>
  );
}

function getPlayCategory(
  typeName: string,
  totalEpisodes: number,
  searchType?: string,
) {
  if (searchType === 'movie')
    return { TitleIcon: Film, accent: playAccents.film };
  if (searchType === 'anime')
    return { TitleIcon: Cat, accent: playAccents.anime };
  if (/电影|Movie/i.test(typeName))
    return { TitleIcon: Film, accent: playAccents.film };
  if (/电视|连续剧|剧集|[国韩美日泰港台]剧|TV|Drama/i.test(typeName)) {
    return { TitleIcon: Tv, accent: playAccents.tv };
  }
  if (/动[漫画]|番[剧组]|Anime|OVA/i.test(typeName)) {
    return { TitleIcon: Cat, accent: playAccents.anime };
  }
  if (/综艺|娱乐|Variety|Show/i.test(typeName)) {
    return { TitleIcon: Clover, accent: playAccents.variety };
  }
  if (totalEpisodes <= 1) return { TitleIcon: Film, accent: playAccents.film };
  return { TitleIcon: Tv, accent: playAccents.tv };
}

export function PlayMainContent(props: PlayMainContentProps) {
  const {
    videoTitle,
    totalEpisodes,
    detail,
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
    onLoadingTimeout,
    searchType,
    realtimeLoadSpeed,
    playbackError,
  } = props;

  const { TitleIcon, accent } = useMemo(
    () => getPlayCategory(detail?.type_name || '', totalEpisodes, searchType),
    [detail?.type_name, totalEpisodes, searchType],
  );

  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const runtimeConfig = useRuntimeConfig();
  const loadingTimeoutSeconds = Math.max(
    1,
    Math.floor(
      runtimeConfig.VOD_PAGE_TIMEOUT_SECONDS ||
        DEFAULT_PLAYER_LOADING_TIMEOUT_SECONDS,
    ),
  );
  const loadingTimeoutMs = loadingTimeoutSeconds * 1000;
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
      setLoadingTimedOut(false);
      return;
    }
    setLoadingTimedOut(false);
    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
      onLoadingTimeoutRef.current?.();
    }, loadingTimeoutMs);
    return () => clearTimeout(timer);
  }, [
    isVideoLoading,
    videoLoadingStage,
    videoLoadingAttempt,
    playbackError,
    loadingTimeoutMs,
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
      titleIcon={TitleIcon}
      accent={accent}
      isPanelCollapsed={isEpisodeSelectorCollapsed}
      onTogglePanel={() =>
        setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
      }
      panelToggleTitle={
        isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
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
          {isVideoLoading && !playbackError && (
            <PlayLoadingOverlay
              loadingTimedOut={loadingTimedOut}
              videoLoadingStage={videoLoadingStage}
              realtimeLoadSpeed={loadingStatusText}
              timeoutSeconds={loadingTimeoutSeconds}
            />
          )}
          {playbackError && (
            <PlaybackErrorOverlay
              message={playbackError}
              onRetry={onRetryPlayback}
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
            <div className='absolute right-4 top-4 z-20 max-w-[min(22rem,calc(100%-2rem))] rounded-lg bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-md'>
              <div className='font-medium'>
                发现更优源：{sourceRecommendation.sourceName}
              </div>
              <div className='mt-0.5 text-white/75'>
                {sourceRecommendation.quality} ·{' '}
                {sourceRecommendation.loadSpeed}
                ，可在换源中手动选择
              </div>
              <button
                className='mt-1 text-white/70 hover:text-white'
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
          videoYear={videoYear}
          favorited={favorited}
          onToggleFavorite={onToggleFavorite}
          videoCover={videoCover}
          videoDoubanId={videoDoubanId}
          onSourceDetailFetched={onSourceDetailFetched}
          onAddSources={onAddSources}
        />
      }
    />
  );
}

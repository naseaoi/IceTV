import { AlertTriangle, Cat, Clover, Film, Tv } from 'lucide-react';
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
import EpisodeSelector from '@/features/play/components/EpisodeSelector';
import { getSourceFailure } from '@/lib/failed-source-cooldown';
import { SearchResult } from '@/lib/types';
import { normalizeInlineText } from '@/lib/utils';

interface PlayMainContentProps {
  videoTitle: string;
  totalEpisodes: number;
  detail: SearchResult | null;
  currentEpisodeIndex: number;
  isEpisodeSelectorCollapsed: boolean;
  setIsEpisodeSelectorCollapsed: (collapsed: boolean) => void;
  artRef: RefObject<HTMLDivElement | null>;
  isVideoLoading: boolean;
  isPlaying: boolean;
  videoLoadingStage: 'initing' | 'sourceChanging';
  videoLoadingAttempt: number;
  realtimeLoadSpeed: string;
  authRecoveryVisible: boolean;
  authRecoveryReasonMessage: string;
  onReloginAndRecover: () => void;
  onDismissAuthRecovery: () => void;
  onEpisodeChange: (episodeNumber: number) => void;
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
  videoYear: string;
  favorited: boolean;
  onToggleFavorite: () => void;
  videoCover: string;
  videoDoubanId: number;
  onSourceDetailFetched?: (updated: SearchResult) => void;
  onAddSources?: (newSources: SearchResult[]) => void;
  onLoadingTimeout?: () => void;
  searchType?: string;
}

const PLAYER_LOADING_TIMEOUT_MS = 15_000;
const PLAYER_LOADING_TIMEOUT_SECONDS = PLAYER_LOADING_TIMEOUT_MS / 1000;

const playAccents: Record<string, PlayerPageAccent> = {
  film: {
    icon: 'text-blue-500 dark:text-blue-400',
    glow: 'bg-blue-400/10 dark:bg-blue-400/20',
    sub: 'text-blue-600/80 dark:text-blue-400/70',
    aurora: ['59,130,246', '96,165,250'],
    auroraLight: ['147,197,253', '191,219,254'],
  },
  tv: {
    icon: 'text-emerald-500 dark:text-emerald-400',
    glow: 'bg-emerald-400/10 dark:bg-emerald-400/20',
    sub: 'text-emerald-600/80 dark:text-emerald-400/70',
    aurora: ['16,185,129', '52,211,153'],
    auroraLight: ['110,231,183', '167,243,208'],
  },
  anime: {
    icon: 'text-pink-500 dark:text-pink-400',
    glow: 'bg-pink-400/10 dark:bg-pink-400/20',
    sub: 'text-pink-600/80 dark:text-pink-400/70',
    aurora: ['236,72,153', '244,114,182'],
    auroraLight: ['249,168,212', '251,207,232'],
  },
  variety: {
    icon: 'text-violet-500 dark:text-violet-400',
    glow: 'bg-violet-400/10 dark:bg-violet-400/20',
    sub: 'text-violet-600/80 dark:text-violet-400/70',
    aurora: ['139,92,246', '167,139,250'],
    auroraLight: ['196,181,253', '221,214,254'],
  },
};

function PlayLoadingOverlay({
  loadingTimedOut,
  videoLoadingStage,
  realtimeLoadSpeed,
}: {
  loadingTimedOut: boolean;
  videoLoadingStage: 'initing' | 'sourceChanging';
  realtimeLoadSpeed: string;
}) {
  const statusText =
    realtimeLoadSpeed ||
    (videoLoadingStage === 'sourceChanging'
      ? '正在切换源站...'
      : '正在加载视频...');

  return (
    <div className='absolute inset-0 z-[500] flex items-center justify-center overflow-hidden rounded-xl bg-black/85 backdrop-blur-sm transition-all duration-300'>
      {loadingTimedOut ? (
        <LoadingStatePanel
          compact
          icon={<AlertTriangle className='h-9 w-9' />}
          tone='red'
          title={
            videoLoadingStage === 'sourceChanging'
              ? '切换播放源超时'
              : '加载视频超时'
          }
          titleClassName='text-xl text-white sm:text-2xl'
          message={`已等待超过 ${PLAYER_LOADING_TIMEOUT_SECONDS} 秒，可能是网络问题或播放源不可用`}
          messageClassName='mx-auto max-w-[16rem] text-sm leading-6 text-gray-300 sm:max-w-none'
          className='max-w-[19rem] p-4 sm:max-w-lg sm:p-6'
        />
      ) : (
        <div className='flex flex-col items-center'>
          <div className='relative'>
            <div className='player-ripple absolute -inset-4 rounded-full border border-emerald-300/40' />
            <div className='player-ripple player-ripple-delay absolute -inset-4 rounded-full border border-emerald-300/40' />
            <div className='player-spinner-shell relative z-[2] mx-auto h-20 w-20 sm:h-24 sm:w-24'>
              <div className='player-ring-outer absolute inset-0 rounded-full border-2 border-transparent bg-gradient-to-r from-emerald-400/70 via-green-500/40 to-emerald-300/20' />
              <div className='player-ring-inner absolute inset-[10px] rounded-full border border-white/30' />
              <div className='absolute inset-[2px] rounded-full bg-transparent' />
              <div className='player-orb absolute right-1 top-2 h-3 w-3 rounded-full bg-emerald-400/40' />
              {videoLoadingStage === 'sourceChanging' && (
                <div className='absolute inset-0 z-10 flex items-center justify-center text-xs font-bold text-white/70'>
                  切换中
                </div>
              )}
            </div>
          </div>
          <div className='mt-5 min-h-[22px] rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/15'>
            {statusText}
          </div>

          <style jsx>{`
            .player-ripple {
              animation: player-ripple 2.4s ease-out infinite;
              transform-origin: center;
            }
            .player-ripple-delay {
              animation-delay: 1.2s;
            }
            .player-spinner-shell {
              filter: drop-shadow(0 8px 26px rgba(0, 0, 0, 0.12));
            }
            .player-ring-outer {
              mask: radial-gradient(circle, transparent 58%, black 59%);
              -webkit-mask: radial-gradient(circle, transparent 58%, black 59%);
              animation: player-rotate 2.6s linear infinite;
            }
            .player-ring-inner {
              animation: player-rotate-reverse 3.3s linear infinite;
            }
            .player-orb {
              animation: player-ping 1.8s ease-out infinite;
            }
            @keyframes player-rotate {
              0% {
                transform: rotate(0deg);
              }
              100% {
                transform: rotate(360deg);
              }
            }
            @keyframes player-rotate-reverse {
              0% {
                transform: rotate(0deg);
              }
              100% {
                transform: rotate(-360deg);
              }
            }
            @keyframes player-ripple {
              0% {
                transform: scale(0.92);
                opacity: 0.45;
              }
              70% {
                transform: scale(1.2);
                opacity: 0;
              }
              100% {
                transform: scale(1.2);
                opacity: 0;
              }
            }
            @keyframes player-ping {
              0% {
                transform: scale(0.9);
                opacity: 0.65;
              }
              70% {
                transform: scale(1.9);
                opacity: 0;
              }
              100% {
                transform: scale(1.9);
                opacity: 0;
              }
            }
          `}</style>
        </div>
      )}
    </div>
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

function buildHeaderTags({
  headerSourceText,
  headerYearText,
  totalEpisodes,
}: {
  headerSourceText: string;
  headerYearText: string;
  totalEpisodes: number;
}) {
  const tags: ReactNode[] = [];

  if (headerSourceText) {
    tags.push(
      <span className='inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-500/20'>
        {headerSourceText}
      </span>,
    );
  }

  if (headerYearText) {
    tags.push(
      <span className='inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-600 ring-1 ring-gray-200/60 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700/60'>
        {headerYearText}
      </span>,
    );
  }

  if (totalEpisodes > 1) {
    tags.push(
      <span className='inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-violet-600 ring-1 ring-violet-200/60 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-500/20'>
        共 {totalEpisodes} 集
      </span>,
    );
  }

  return tags;
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
    isPlaying,
    videoLoadingStage,
    videoLoadingAttempt,
    authRecoveryVisible,
    authRecoveryReasonMessage,
    onReloginAndRecover,
    onDismissAuthRecovery,
    onEpisodeChange,
    onSourceChange,
    currentSource,
    currentId,
    searchTitle,
    availableSources,
    sourceSearchLoading,
    sourceSearchError,
    precomputedVideoInfo,
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
  } = props;

  const { TitleIcon, accent } = useMemo(
    () => getPlayCategory(detail?.type_name || '', totalEpisodes, searchType),
    [detail?.type_name, totalEpisodes, searchType],
  );

  const currentSourceMeta = useMemo(() => {
    return availableSources.find(
      (item) =>
        item.source?.toString() === currentSource?.toString() &&
        item.id?.toString() === currentId?.toString(),
    );
  }, [availableSources, currentSource, currentId]);

  const headerSourceText = [
    currentSourceMeta?.source_name ||
      currentSourceMeta?.source?.toString() ||
      currentSource?.toString() ||
      '',
    normalizeInlineText(currentSourceMeta?.variant_label || ''),
  ]
    .filter(Boolean)
    .join(' · ');
  const headerYearText = (detail?.year || videoYear || '').toString();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const onLoadingTimeoutRef = useRef(onLoadingTimeout);
  const currentSourceFailure = useMemo(() => {
    const key =
      currentSource && currentId ? `${currentSource}-${currentId}` : '';
    return key ? getSourceFailure(key) : null;
  }, [currentSource, currentId, isVideoLoading, videoLoadingAttempt]);
  const loadingStatusText =
    realtimeLoadSpeed ||
    (currentSourceFailure?.coolingDown
      ? `当前源${currentSourceFailure.label}`
      : '');

  useEffect(() => {
    onLoadingTimeoutRef.current = onLoadingTimeout;
  }, [onLoadingTimeout]);

  useEffect(() => {
    if (!isVideoLoading) {
      setLoadingTimedOut(false);
      return;
    }
    setLoadingTimedOut(false);
    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
      onLoadingTimeoutRef.current?.();
    }, PLAYER_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isVideoLoading, videoLoadingStage, videoLoadingAttempt]);

  const headerTags = buildHeaderTags({
    headerSourceText,
    headerYearText,
    totalEpisodes,
  });

  return (
    <PlayerPageLayout
      activePath='/play'
      title={videoTitle}
      titleFallback='影片标题'
      titleIcon={TitleIcon}
      accent={accent}
      isPlaying={isPlaying}
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
      tags={headerTags}
      playerOverlay={
        <>
          {isVideoLoading && (
            <PlayLoadingOverlay
              loadingTimedOut={loadingTimedOut}
              videoLoadingStage={videoLoadingStage}
              realtimeLoadSpeed={loadingStatusText}
            />
          )}
          {authRecoveryVisible && (
            <AuthRecoveryOverlay
              message={authRecoveryReasonMessage}
              onReloginAndRecover={onReloginAndRecover}
              onDismissAuthRecovery={onDismissAuthRecovery}
            />
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

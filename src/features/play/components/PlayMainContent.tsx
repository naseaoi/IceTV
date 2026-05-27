import { AlertTriangle, Cat, Clover, Film, Play, Tv } from 'lucide-react';
import { RefObject, useEffect, useMemo, useRef, useState } from 'react';

import EpisodeSelector from '@/features/play/components/EpisodeSelector';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';
import { BackButton } from '@/components/BackButton';
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
  /** 加载超时触发：由外层决定是否自动切到下一个候选源 */
  onLoadingTimeout?: () => void;
  /** URL 的 stype 参数（movie/tv/anime），用于在 type_name 不可靠时强制分类 */
  searchType?: string;
}

const PLAYER_LOADING_TIMEOUT_MS = 15_000;
const PLAYER_LOADING_TIMEOUT_SECONDS = PLAYER_LOADING_TIMEOUT_MS / 1000;

const TogglePanelButton = ({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className='flex items-center gap-1.5 rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
    title={collapsed ? '显示选集面板' : '隐藏选集面板'}
  >
    <svg
      className={`h-4 w-4 transition-transform duration-200 ${
        collapsed ? 'rotate-180' : 'rotate-0'
      }`}
      fill='none'
      stroke='currentColor'
      viewBox='0 0 24 24'
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='2'
        d='M9 5l7 7-7 7'
      />
    </svg>
    <span className='text-xs font-medium'>{collapsed ? '显示' : '隐藏'}</span>
  </button>
);

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
    realtimeLoadSpeed,
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
  } = props;

  // 根据 detail.type_name 选择标题图标和分类颜色
  const { TitleIcon, categoryColor } = useMemo(() => {
    const typeName = detail?.type_name || '';
    // 颜色配置：icon(图标色) / glow(光晕) / sub(副标题) / aurora(流光rgba)
    const colors = {
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
    // URL 里 stype 是豆瓣列表/搜索页带入的强信号，优先于源站返回的 type_name：
    // 部分源站 type_name 为空或只给 "剧情片/动作片" 等三级分类，正则命中率低，
    // 易被兜底判成 Tv（多版本电影被当剧集处理）。
    if (searchType === 'movie')
      return { TitleIcon: Film, categoryColor: colors.film };
    if (searchType === 'anime')
      return { TitleIcon: Cat, categoryColor: colors.anime };
    if (/电影|Movie/i.test(typeName))
      return { TitleIcon: Film, categoryColor: colors.film };
    if (/电视|连续剧|剧集|[国韩美日泰港台]剧|TV|Drama/i.test(typeName))
      return { TitleIcon: Tv, categoryColor: colors.tv };
    if (/动[漫画]|番[剧组]|Anime|OVA/i.test(typeName))
      return { TitleIcon: Cat, categoryColor: colors.anime };
    if (/综艺|娱乐|Variety|Show/i.test(typeName))
      return { TitleIcon: Clover, categoryColor: colors.variety };
    if (totalEpisodes <= 1)
      return { TitleIcon: Film, categoryColor: colors.film };
    return { TitleIcon: Tv, categoryColor: colors.tv };
  }, [detail?.type_name, totalEpisodes, searchType]);

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

  // 播放器容器高度：面板展开时用 aspect-video 自适应，面板折叠时锁定高度
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const [playerHeight, setPlayerHeight] = useState<number | null>(null);
  // 记录面板展开时的播放器高度，面板折叠时用此值锁定
  const expandedHeightRef = useRef<number | null>(null);

  useEffect(() => {
    const el = playerWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h > 0) {
        setPlayerHeight(h);
        if (!isEpisodeSelectorCollapsed) {
          expandedHeightRef.current = h;
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isEpisodeSelectorCollapsed]);

  // 追踪是否为桌面端（md: 768px+），用于面板高度策略切换
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 视频加载超时检测（15秒）
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  // 把回调塞进 ref，避免父级 callback identity 抖动导致超时定时器反复重启。
  const onLoadingTimeoutRef = useRef(onLoadingTimeout);
  useEffect(() => {
    onLoadingTimeoutRef.current = onLoadingTimeout;
  }, [onLoadingTimeout]);

  useEffect(() => {
    // 每次发起新的加载轮次都重置超时计时，避免上一轮超时状态残留到下一次换源。
    if (!isVideoLoading) {
      setLoadingTimedOut(false);
      return;
    }
    setLoadingTimedOut(false);
    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
      // 通知外层尝试自动切换到下一个候选源；若无可降级源则保持超时面板
      onLoadingTimeoutRef.current?.();
    }, PLAYER_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isVideoLoading, videoLoadingStage, videoLoadingAttempt]);

  return (
    <PageLayout activePath='/play'>
      <div className='relative flex h-full min-h-0 flex-col gap-3 overflow-hidden px-4 py-2 sm:px-6 md:overflow-visible lg:px-[3rem] 2xl:px-20'>
        {/* 顶部流光背景层：不占高度，四周渐隐形成柔和边界 */}
        <div className='pointer-events-none absolute -inset-x-16 top-0 h-80 overflow-hidden'>
          <div
            className='absolute inset-0 dark:hidden'
            style={{
              background: [
                `radial-gradient(ellipse 90% 60% at 30% 0%, rgba(${categoryColor.aurora[0]},0.10) 0%, transparent 70%)`,
                `radial-gradient(ellipse 60% 50% at 70% 5%, rgba(${categoryColor.aurora[1]},0.08) 0%, transparent 70%)`,
                `radial-gradient(ellipse 50% 45% at 45% 20%, rgba(${categoryColor.aurora[0]},0.06) 0%, transparent 65%)`,
              ].join(', '),
              animation: 'aurora-breathe 8s ease-in-out infinite',
              animationPlayState: isPlaying ? 'running' : 'paused',
              transformOrigin: 'top center',
              mask: 'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
              WebkitMask:
                'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
            }}
          />
          <div
            className='absolute inset-0 hidden dark:block'
            style={{
              background: [
                `radial-gradient(ellipse 90% 60% at 30% 0%, rgba(${categoryColor.auroraLight[0]},0.16) 0%, transparent 70%)`,
                `radial-gradient(ellipse 60% 50% at 70% 5%, rgba(${categoryColor.auroraLight[1]},0.12) 0%, transparent 70%)`,
                `radial-gradient(ellipse 50% 45% at 45% 20%, rgba(${categoryColor.auroraLight[0]},0.09) 0%, transparent 65%)`,
              ].join(', '),
              animation: 'aurora-breathe 8s ease-in-out infinite',
              animationPlayState: isPlaying ? 'running' : 'paused',
              transformOrigin: 'top center',
              mask: 'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
              WebkitMask:
                'linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)',
            }}
          />
        </div>

        {/* 顶部间距 */}
        <div className='h-1 flex-shrink-0 sm:h-4' />

        {/* 标题区域 */}
        <div className='relative flex-shrink-0 pb-3'>
          {/* 第一行：标题居中 */}
          <div className='flex justify-center'>
            <h1 className='flex min-w-0 items-center gap-2.5 text-xl font-bold text-gray-900 dark:text-gray-100 sm:text-2xl'>
              <span className='relative flex-shrink-0'>
                <TitleIcon className={`h-6 w-6 ${categoryColor.icon}`} />
                <span
                  className={`absolute -inset-1.5 rounded-full ${categoryColor.glow} blur-sm`}
                />
              </span>
              <span className='max-w-[60vw] truncate sm:max-w-[50vw]'>
                {videoTitle || '影片标题'}
              </span>
              {totalEpisodes > 1 && (
                <>
                  <span className='h-4 w-px flex-shrink-0 bg-gray-300 dark:bg-gray-600' />
                  <span
                    className={`text-sm font-semibold ${categoryColor.sub} flex-shrink-0 whitespace-nowrap`}
                  >
                    {detail?.episodes_titles?.[currentEpisodeIndex] ||
                      `第 ${currentEpisodeIndex + 1} 集`}
                  </span>
                </>
              )}
            </h1>
          </div>

          {/* 第二行：返回按钮 + 标签 + 折叠按钮 */}
          <div className='relative mt-2 flex min-h-[1.75rem] items-center justify-center md:justify-between'>
            <div className='hidden flex-shrink-0 md:block'>
              <BackButton />
            </div>

            <div className='flex items-center justify-center md:pointer-events-none md:absolute md:inset-0'>
              <div className='flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium'>
                {headerSourceText && (
                  <span className='inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-500/20'>
                    {headerSourceText}
                  </span>
                )}
                {headerYearText && (
                  <span className='inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-600 ring-1 ring-gray-200/60 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700/60'>
                    {headerYearText}
                  </span>
                )}
                {totalEpisodes > 1 && (
                  <span className='inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-violet-600 ring-1 ring-violet-200/60 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-500/20'>
                    共 {totalEpisodes} 集
                  </span>
                )}
              </div>
            </div>

            <div className='hidden flex-shrink-0 lg:block'>
              <TogglePanelButton
                collapsed={isEpisodeSelectorCollapsed}
                onClick={() =>
                  setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
                }
              />
            </div>
          </div>
        </div>

        {/* 标题区域分隔线 */}
        <div className='h-px flex-shrink-0 bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10]' />

        {/* 播放器 + 选集面板 */}
        <div
          className={`grid min-h-0 flex-1 ${
            isEpisodeSelectorCollapsed
              ? 'grid-cols-1'
              : 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 md:grid-cols-4 md:grid-rows-1'
          }`}
        >
          {/* 播放器 */}
          <div
            className={`overflow-hidden rounded-xl ${
              isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
            }`}
          >
            <div
              ref={playerWrapRef}
              className={`relative max-h-[38dvh] w-full md:max-h-[80vh] ${isEpisodeSelectorCollapsed ? '' : 'aspect-video'}`}
              style={
                isEpisodeSelectorCollapsed && expandedHeightRef.current
                  ? { height: `${expandedHeightRef.current}px` }
                  : undefined
              }
            >
              {/* 播放器绝对定位填满容器 */}
              <div className='absolute inset-0'>
                <div
                  ref={artRef}
                  className='h-full w-full overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-black/10 dark:ring-white/10'
                ></div>

                {isVideoLoading && (
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
                        {/* 复用全局 LoadingStatePanel 的 spinner 结构 */}
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
                            mask: radial-gradient(
                              circle,
                              transparent 58%,
                              black 59%
                            );
                            -webkit-mask: radial-gradient(
                              circle,
                              transparent 58%,
                              black 59%
                            );
                            animation: player-rotate 2.6s linear infinite;
                          }
                          .player-ring-inner {
                            animation: player-rotate-reverse 3.3s linear
                              infinite;
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
                )}

                {authRecoveryVisible && (
                  <div className='absolute inset-0 z-[520] flex items-center justify-center rounded-xl bg-black/80 backdrop-blur-sm'>
                    <div className='mx-4 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900/95 p-6 text-center shadow-2xl'>
                      <div className='mb-3 text-4xl'>🔐</div>
                      <h3 className='mb-2 text-lg font-semibold text-white'>
                        登录状态异常
                      </h3>
                      <p className='mb-5 text-sm leading-6 text-zinc-300'>
                        {authRecoveryReasonMessage}
                      </p>
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
                )}
              </div>
            </div>
          </div>

          {/* 选集面板 */}
          <div
            className={`min-h-0 overflow-hidden ${
              isEpisodeSelectorCollapsed
                ? 'h-0 md:col-span-1 lg:pointer-events-none lg:max-w-0 lg:opacity-0'
                : 'md:col-span-1 lg:max-w-[100%] lg:opacity-100'
            }`}
            style={
              isEpisodeSelectorCollapsed
                ? undefined
                : playerHeight
                  ? isDesktop
                    ? { height: `${playerHeight}px` }
                    : { height: '100%' }
                  : isDesktop
                    ? { height: '300px' }
                    : { height: '100%' }
            }
          >
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
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

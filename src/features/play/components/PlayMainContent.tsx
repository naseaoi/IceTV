/* eslint-disable @next/next/no-img-element */

import { Clapperboard, Heart, Loader2, RefreshCw } from 'lucide-react';
import { RefObject } from 'react';

import EpisodeSelector from '@/components/EpisodeSelector';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

interface PlayMainContentProps {
  videoTitle: string;
  totalEpisodes: number;
  detail: SearchResult | null;
  currentEpisodeIndex: number;
  isEpisodeSelectorCollapsed: boolean;
  setIsEpisodeSelectorCollapsed: (collapsed: boolean) => void;
  artRef: RefObject<HTMLDivElement>;
  isVideoLoading: boolean;
  videoLoadingStage: 'initing' | 'sourceChanging';
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
}

const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444'
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

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
  } = props;

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > ${
                  detail?.episodes_titles?.[currentEpisodeIndex] ||
                  `第 ${currentEpisodeIndex + 1} 集`
                }`}
              </span>
            )}
          </h1>
        </div>
        <div className='space-y-2'>
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
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
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <LoadingStatePanel
                      compact
                      icon={
                        videoLoadingStage === 'sourceChanging' ? (
                          <RefreshCw className='w-9 h-9' />
                        ) : (
                          <Clapperboard className='w-9 h-9' />
                        )
                      }
                      tone='emerald'
                      title={
                        videoLoadingStage === 'sourceChanging'
                          ? '切换播放源中...'
                          : '视频加载中...'
                      }
                      description='正在建立播放器连接并缓冲首段视频。'
                    >
                      <div className='flex items-center justify-center text-emerald-300'>
                        <Loader2 className='w-5 h-5 animate-spin' />
                      </div>
                    </LoadingStatePanel>
                  </div>
                )}

                {authRecoveryVisible && (
                  <div className='absolute inset-0 bg-black/80 backdrop-blur-sm rounded-xl flex items-center justify-center z-[520]'>
                    <div className='w-full max-w-md mx-4 bg-zinc-900/95 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-center'>
                      <div className='text-4xl mb-3'>🔐</div>
                      <h3 className='text-lg font-semibold text-white mb-2'>
                        登录状态异常
                      </h3>
                      <p className='text-sm text-zinc-300 leading-6 mb-5'>
                        {authRecoveryReasonMessage}
                      </p>
                      <div className='space-y-2'>
                        <button
                          onClick={onReloginAndRecover}
                          className='w-full px-4 py-2.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-500 transition-colors'
                        >
                          去登录并恢复播放
                        </button>
                        <button
                          onClick={onDismissAuthRecovery}
                          className='w-full px-4 py-2.5 rounded-lg bg-zinc-700 text-zinc-200 font-medium hover:bg-zinc-600 transition-colors'
                        >
                          稍后处理
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={onEpisodeChange}
                onSourceChange={onSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
              />
            </div>
          </div>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                {videoTitle || '影片标题'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </h1>

              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>

              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='relative bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <>
                    <img
                      src={processImageUrl(videoCover)}
                      alt={videoTitle}
                      className='w-full h-full object-cover'
                    />

                    {videoDoubanId !== 0 && (
                      <a
                        href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='absolute top-3 left-3'
                      >
                        <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                          <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                          </svg>
                        </div>
                      </a>
                    )}
                  </>
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

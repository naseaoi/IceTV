import {
  AlertTriangle,
  Clapperboard,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react';
import { RefObject, useEffect, useState } from 'react';

import EpisodeSelector from '@/components/EpisodeSelector';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';
import { SearchResult } from '@/lib/types';

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

const TogglePanelButton = ({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className='group relative flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-700 backdrop-blur-sm border border-gray-200/60 dark:border-gray-700/60 shadow-sm hover:shadow transition-all duration-200'
    title={collapsed ? '显示选集面板' : '隐藏选集面板'}
  >
    <svg
      className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
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
    <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
      {collapsed ? '显示' : '隐藏'}
    </span>
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

  // 视频加载超时检测（30秒）
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!isVideoLoading) {
      setLoadingTimedOut(false);
      return;
    }
    setLoadingTimedOut(false);
    const timer = setTimeout(() => setLoadingTimedOut(true), 30_000);
    return () => clearTimeout(timer);
  }, [isVideoLoading, videoLoadingStage]);

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-4 py-4 px-4 sm:px-6 lg:px-[3rem] 2xl:px-20'>
        {/* 标题栏 + 折叠按钮 */}
        <div className='flex items-center relative'>
          {/* 标题居中于播放器区域 */}
          <div
            className={`transition-[width] duration-300 ease-in-out flex justify-center ${
              isEpisodeSelectorCollapsed ? 'w-full' : 'w-full md:w-3/4'
            }`}
          >
            <h1 className='flex items-center gap-3 text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 min-w-0'>
              <Play className='w-6 h-6 text-green-500 flex-shrink-0' />
              <span className='truncate max-w-[60vw] sm:max-w-[50vw]'>
                {videoTitle || '影片标题'}
              </span>
              {totalEpisodes > 1 && (
                <span className='text-sm font-medium text-gray-400 dark:text-gray-500 flex-shrink-0'>
                  {detail?.episodes_titles?.[currentEpisodeIndex] ||
                    `第 ${currentEpisodeIndex + 1} 集`}
                </span>
              )}
            </h1>
          </div>

          {/* 折叠/展开按钮 — 始终固定在右侧 */}
          <div className='hidden lg:block absolute right-0 top-1/2 -translate-y-1/2'>
            <TogglePanelButton
              collapsed={isEpisodeSelectorCollapsed}
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
            />
          </div>
        </div>

        {/* 播放器 + 选集面板 */}
        <div
          className={`grid lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-[grid-template-columns] duration-300 ease-in-out ${
            isEpisodeSelectorCollapsed
              ? 'grid-cols-1 grid-rows-1'
              : 'grid-cols-1 md:grid-cols-4 gap-3'
          }`}
        >
          {/* 播放器 */}
          <div
            className={`h-full transition-all duration-300 ease-in-out rounded-xl overflow-hidden ${
              isEpisodeSelectorCollapsed
                ? 'col-span-1 row-span-1'
                : 'md:col-span-3'
            }`}
          >
            <div className='relative w-full h-[300px] lg:h-full'>
              <div
                ref={artRef}
                className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg ring-1 ring-black/10 dark:ring-white/10'
              ></div>

              {isVideoLoading && (
                <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                  {loadingTimedOut ? (
                    <LoadingStatePanel
                      compact
                      icon={<AlertTriangle className='w-9 h-9' />}
                      tone='red'
                      title={
                        videoLoadingStage === 'sourceChanging'
                          ? '切换播放源超时'
                          : '加载视频超时'
                      }
                      titleClassName='text-white'
                    >
                      <p className='text-sm text-gray-300 text-center mb-3'>
                        已等待超过 30 秒，可能是网络问题或播放源不可用
                      </p>
                      <button
                        onClick={() => window.location.reload()}
                        className='flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium transition-colors'
                      >
                        <RefreshCw className='w-4 h-4' />
                        刷新页面重试
                      </button>
                    </LoadingStatePanel>
                  ) : (
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
                          ? '正在切换播放源'
                          : '正在加载视频'
                      }
                      titleClassName='text-white'
                    >
                      <div className='flex items-center justify-center text-emerald-300'>
                        <Loader2 className='w-5 h-5 animate-spin' />
                      </div>
                    </LoadingStatePanel>
                  )}
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

          {/* 选集面板 */}
          <div
            className={`md:overflow-hidden transition-[opacity,transform] duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'h-0 md:col-span-1 lg:opacity-0 lg:scale-95 lg:pointer-events-none lg:overflow-hidden'
                : 'h-[300px] lg:h-full md:col-span-1 lg:opacity-100 lg:scale-100'
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
              detail={detail}
              videoYear={videoYear}
              favorited={favorited}
              onToggleFavorite={onToggleFavorite}
              videoCover={videoCover}
              videoDoubanId={videoDoubanId}
            />
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

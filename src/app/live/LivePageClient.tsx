'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Radio,
  RefreshCw,
  Tv,
  X,
} from 'lucide-react';
import { Suspense, useRef } from 'react';

import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';

import { LiveChannelInfo } from '@/features/live/components/LiveChannelInfo';
import { LiveChannelSidebar } from '@/features/live/components/LiveChannelSidebar';
import { useLiveFavorite } from '@/features/live/hooks/useLiveFavorite';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';
import { useLivePlayer } from '@/features/live/hooks/useLivePlayer';
import '@/features/live/types';
import { useLiveSources } from '@/features/live/hooks/useLiveSources';

function LivePageClient() {
  const artRef = useRef<HTMLDivElement | null>(null);
  const groupContainerRef = useRef<HTMLDivElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);

  const cleanupPlayerRef = useRef<() => void>(() => {});

  const sources = useLiveSources({
    cleanupPlayer: () => cleanupPlayerRef.current(),
    channelListRef,
    groupContainerRef,
  });

  const { artPlayerRef, cleanupPlayer } = useLivePlayer({
    videoUrl: sources.videoUrl,
    currentChannel: sources.currentChannel,
    currentSourceRef: sources.currentSourceRef,
    loading: sources.loading,
    artRef,
    setError: sources.setError,
    setIsVideoLoading: sources.setIsVideoLoading,
    setUnsupportedType: sources.setUnsupportedType,
  });

  cleanupPlayerRef.current = cleanupPlayer;

  usePlayerKeyboard({ artPlayerRef });

  const { favorited, handleToggleFavorite } = useLiveFavorite({
    currentSource: sources.currentSource,
    currentChannel: sources.currentChannel,
    currentSourceRef: sources.currentSourceRef,
    currentChannelRef: sources.currentChannelRef,
  });

  if (sources.loading) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex h-[calc(100dvh-3rem-3.5rem-env(safe-area-inset-bottom))] items-center justify-center md:h-full'>
          <div className='flex w-full max-w-2xl flex-col items-center gap-4 px-4'>
            <LoadingStatePanel
              icon={
                sources.loadingStage === 'ready' ? (
                  <CheckCircle2 className='h-10 w-10' />
                ) : (
                  <Tv className='h-10 w-10' />
                )
              }
              tone='blue'
              title='正在加载'
              message={sources.loadingMessage}
              progress={sources.loadingProgress}
            />
            <button
              onClick={() => sources.router.back()}
              aria-label='取消加载'
              title='取消加载'
              className='inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
            >
              <X className='h-5 w-5' />
            </button>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (sources.error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex min-h-screen items-center justify-center bg-transparent'>
          <LoadingStatePanel
            icon={<AlertTriangle className='h-10 w-10' />}
            tone='red'
            title='哎呀，出现了一些问题'
            message={sources.error}
            description='请检查网络连接或稍后重试。'
          >
            <button
              onClick={() => window.location.reload()}
              className='flex w-full transform items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:scale-105 hover:from-blue-600 hover:to-cyan-700 hover:shadow-xl'
            >
              <RefreshCw className='h-4 w-4' />
              重新尝试
            </button>
          </LoadingStatePanel>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/live'>
      <div className='flex flex-col gap-3 px-5 py-4 lg:px-[3rem] 2xl:px-20'>
        <div className='py-1'>
          <h1 className='flex max-w-[80%] items-center gap-2 text-xl font-semibold text-gray-900 dark:text-gray-100'>
            <Radio className='h-5 w-5 flex-shrink-0 text-blue-500' />
            <div className='min-w-0 flex-1'>
              <div className='truncate'>
                {sources.currentSource?.name}
                {sources.currentSource && sources.currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${sources.currentChannel.name}`}
                  </span>
                )}
                {sources.currentSource && !sources.currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${sources.currentSource.name}`}
                  </span>
                )}
              </div>
            </div>
          </h1>
        </div>

        <div className='space-y-2'>
          <div className='hidden justify-end lg:flex'>
            <button
              onClick={() =>
                sources.setIsChannelListCollapsed(
                  !sources.isChannelListCollapsed,
                )
              }
              className='group relative flex items-center space-x-1.5 rounded-full border border-gray-200/50 bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-white hover:shadow-md dark:border-gray-700/50 dark:bg-gray-800/80 dark:hover:bg-gray-800'
              title={
                sources.isChannelListCollapsed ? '显示频道列表' : '隐藏频道列表'
              }
            >
              <svg
                className={`h-3.5 w-3.5 text-gray-500 transition-transform duration-200 dark:text-gray-400 ${
                  sources.isChannelListCollapsed ? 'rotate-180' : 'rotate-0'
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
                {sources.isChannelListCollapsed ? '显示' : '隐藏'}
              </span>
              <div
                className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full transition-all duration-200 ${
                  sources.isChannelListCollapsed
                    ? 'animate-pulse bg-orange-400'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 transition-all duration-300 ease-in-out lg:h-[500px] xl:h-[650px] 2xl:h-[750px] ${
              sources.isChannelListCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            <div
              className={`h-full transition-all duration-300 ease-in-out ${sources.isChannelListCollapsed ? 'col-span-1' : 'md:col-span-3'}`}
            >
              <div className='relative h-[300px] w-full lg:h-full'>
                <div
                  ref={artRef}
                  className='h-full w-full overflow-hidden rounded-xl border border-white/0 bg-black shadow-lg dark:border-white/30'
                ></div>

                {sources.unsupportedType && (
                  <div className='absolute inset-0 z-[600] flex items-center justify-center overflow-hidden rounded-xl border border-white/0 bg-black/90 shadow-lg backdrop-blur-sm transition-all duration-300 dark:border-white/30'>
                    <LoadingStatePanel
                      compact
                      icon={<AlertTriangle className='h-9 w-9' />}
                      tone='amber'
                      title='暂不支持的直播流类型'
                      message={sources.unsupportedType.toUpperCase()}
                      description='目前仅支持 M3U8 格式，请尝试其他频道。'
                    />
                  </div>
                )}

                {sources.isVideoLoading && (
                  <div className='absolute inset-0 z-[500] flex items-center justify-center overflow-hidden rounded-xl border border-white/0 bg-black/85 shadow-lg backdrop-blur-sm transition-all duration-300 dark:border-white/30'>
                    <LoadingStatePanel
                      compact
                      icon={<Tv className='h-9 w-9' />}
                      tone='blue'
                      title='IPTV 加载中...'
                      description='正在拉取频道流并初始化播放器缓冲。'
                    >
                      <div className='flex items-center justify-center text-sky-300'>
                        <Loader2 className='h-5 w-5 animate-spin' />
                      </div>
                    </LoadingStatePanel>
                  </div>
                )}
              </div>
            </div>

            <LiveChannelSidebar
              activeTab={sources.activeTab}
              setActiveTab={sources.setActiveTab}
              isChannelListCollapsed={sources.isChannelListCollapsed}
              isSwitchingSource={sources.isSwitchingSource}
              groupedChannels={sources.groupedChannels}
              selectedGroup={sources.selectedGroup}
              filteredChannels={sources.filteredChannels}
              currentChannel={sources.currentChannel}
              currentSource={sources.currentSource}
              liveSources={sources.liveSources}
              groupContainerRef={groupContainerRef}
              channelListRef={channelListRef}
              handleGroupChange={sources.handleGroupChange}
              handleChannelChange={sources.handleChannelChange}
              handleSourceChange={sources.handleSourceChange}
            />
          </div>
        </div>

        {sources.currentChannel && (
          <LiveChannelInfo
            currentChannel={sources.currentChannel}
            currentSource={sources.currentSource}
            favorited={favorited}
            handleToggleFavorite={handleToggleFavorite}
            epgData={sources.epgData}
            isEpgLoading={sources.isEpgLoading}
          />
        )}
      </div>
    </PageLayout>
  );
}

export default function LivePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LivePageClient />
    </Suspense>
  );
}

'use client';

import '@/features/live/types';

import {
  AlertTriangle,
  CheckCircle2,
  Radio,
  RefreshCw,
  Tv,
  X,
} from 'lucide-react';
import { ReactNode, Suspense, useMemo, useRef } from 'react';

import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';
import {
  PlayerPageAccent,
  PlayerPageLayout,
} from '@/components/PlayerPageLayout';
import { LiveChannelSidebar } from '@/features/live/components/LiveChannelSidebar';
import { useLiveFavorite } from '@/features/live/hooks/useLiveFavorite';
import { useLivePlayer } from '@/features/live/hooks/useLivePlayer';
import { useLiveSources } from '@/features/live/hooks/useLiveSources';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';

const liveAccent: PlayerPageAccent = {
  icon: 'text-sky-500 dark:text-sky-400',
  glow: 'bg-sky-400/10 dark:bg-sky-400/20',
  sub: 'text-sky-600/80 dark:text-sky-400/70',
};

function LiveLoadingView({
  stage,
  message,
  progress,
  onBack,
}: {
  stage: 'loading' | 'fetching' | 'ready';
  message: string;
  progress: number;
  onBack: () => void;
}) {
  return (
    <PageLayout activePath='/live' contentMode='player' showDesktopBack={false}>
      <div className='flex h-full items-center justify-center'>
        <div className='flex w-full max-w-2xl flex-col items-center gap-4 px-4'>
          <LoadingStatePanel
            icon={
              stage === 'ready' ? (
                <CheckCircle2 className='h-10 w-10' />
              ) : (
                <Tv className='h-10 w-10' />
              )
            }
            tone='blue'
            glow
            title='正在加载'
            message={message}
            progress={progress}
          />
          <button
            onClick={onBack}
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

function LiveErrorView({ error }: { error: string }) {
  const isAuthError = error.includes('登录');

  return (
    <PageLayout activePath='/live' contentMode='player' showDesktopBack={false}>
      <div className='flex h-full items-center justify-center bg-transparent'>
        <LoadingStatePanel
          icon={<AlertTriangle className='h-10 w-10' />}
          tone='red'
          title='哎呀，出现了一些问题'
          message={error}
          description={isAuthError ? undefined : '请检查网络连接或稍后重试。'}
        >
          {isAuthError ? null : (
            <button
              onClick={() => window.location.reload()}
              className='flex w-full transform items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:scale-105 hover:from-blue-600 hover:to-cyan-700 hover:shadow-xl'
            >
              <RefreshCw className='h-4 w-4' />
              重新尝试
            </button>
          )}
        </LoadingStatePanel>
      </div>
    </PageLayout>
  );
}

function buildLiveHeaderTags({
  sourceName,
  groupName,
  channelCount,
}: {
  sourceName: string;
  groupName: string;
  channelCount: number;
}) {
  const tags: ReactNode[] = [];

  if (sourceName) {
    tags.push(
      <span className='inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-500/20'>
        {sourceName}
      </span>,
    );
  }

  if (groupName) {
    tags.push(
      <span className='inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-600 ring-1 ring-gray-200/60 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700/60'>
        {groupName}
      </span>,
    );
  }

  if (channelCount > 0) {
    tags.push(
      <span className='inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-sky-700 ring-1 ring-sky-200/60 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-500/20'>
        共 {channelCount} 个频道
      </span>,
    );
  }

  return tags;
}

function LivePlayerOverlay({
  unsupportedType,
  isVideoLoading,
}: {
  unsupportedType: string | null;
  isVideoLoading: boolean;
}) {
  return (
    <>
      {unsupportedType && (
        <div className='absolute inset-0 z-[600] flex items-center justify-center overflow-hidden rounded-xl bg-black/90 shadow-lg backdrop-blur-sm transition-all duration-300'>
          <LoadingStatePanel
            compact
            icon={<AlertTriangle className='h-9 w-9' />}
            tone='amber'
            title='暂不支持的直播流类型'
            message={unsupportedType.toUpperCase()}
            description='目前仅支持 M3U8 格式，请尝试其他频道。'
          />
        </div>
      )}

      {isVideoLoading && (
        <div className='absolute inset-0 z-[500] flex items-center justify-center overflow-hidden rounded-xl bg-black/85 shadow-lg backdrop-blur-sm transition-all duration-300'>
          <LoadingStatePanel
            compact
            glow
            icon={<Tv className='h-9 w-9' />}
            tone='blue'
            title='IPTV 加载中...'
            description='正在拉取频道流并初始化播放器缓冲。'
          />
        </div>
      )}
    </>
  );
}

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

  const headerTags = useMemo(
    () =>
      buildLiveHeaderTags({
        sourceName: sources.currentSource?.name || '',
        groupName: sources.currentChannel?.group || '',
        channelCount:
          sources.currentChannels.length ||
          sources.currentSource?.channelNumber ||
          0,
      }),
    [
      sources.currentChannel?.group,
      sources.currentChannels.length,
      sources.currentSource?.channelNumber,
      sources.currentSource?.name,
    ],
  );

  if (sources.loading) {
    return (
      <LiveLoadingView
        stage={sources.loadingStage}
        message={sources.loadingMessage}
        progress={sources.loadingProgress}
        onBack={() => sources.router.back()}
      />
    );
  }

  if (sources.error) {
    return <LiveErrorView error={sources.error} />;
  }

  return (
    <PlayerPageLayout
      activePath='/live'
      title={sources.currentChannel?.name || sources.currentSource?.name || ''}
      titleFallback='直播'
      titleIcon={Radio}
      accent={liveAccent}
      isPanelCollapsed={sources.isChannelListCollapsed}
      onTogglePanel={() =>
        sources.setIsChannelListCollapsed(!sources.isChannelListCollapsed)
      }
      panelToggleTitle={
        sources.isChannelListCollapsed ? '显示直播面板' : '隐藏直播面板'
      }
      artRef={artRef}
      titleSuffix={sources.currentChannel?.group || null}
      tags={headerTags}
      playerOverlay={
        <LivePlayerOverlay
          unsupportedType={sources.unsupportedType}
          isVideoLoading={sources.isVideoLoading}
        />
      }
      rightPanel={
        <LiveChannelSidebar
          activeTab={sources.activeTab}
          setActiveTab={sources.setActiveTab}
          isSwitchingSource={sources.isSwitchingSource}
          groupedChannels={sources.groupedChannels}
          selectedGroup={sources.selectedGroup}
          filteredChannels={sources.filteredChannels}
          currentChannel={sources.currentChannel}
          currentSource={sources.currentSource}
          liveSources={sources.liveSources}
          epgData={sources.epgData}
          isEpgLoading={sources.isEpgLoading}
          favorited={favorited}
          handleToggleFavorite={handleToggleFavorite}
          groupContainerRef={groupContainerRef}
          channelListRef={channelListRef}
          handleGroupChange={sources.handleGroupChange}
          handleChannelChange={sources.handleChannelChange}
          handleSourceChange={sources.handleSourceChange}
        />
      }
    />
  );
}

export default function LivePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LivePageClient />
    </Suspense>
  );
}

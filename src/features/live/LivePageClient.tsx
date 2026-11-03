'use client';

import '@/features/live/types';

import { AlertTriangle, CheckCircle2, RefreshCw, Tv } from 'lucide-react';
import { ReactNode, Suspense, useMemo, useRef } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import {
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
} from '@/components/modals/modal-styles';
import PageLayout from '@/components/PageLayout';
import { PlayerPageLayout } from '@/components/PlayerPageLayout';
import PlayerStateOverlay, {
  PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS,
} from '@/components/PlayerStateOverlay';
import { LiveChannelSidebar } from '@/features/live/components/LiveChannelSidebar';
import { useLiveFavorite } from '@/features/live/hooks/useLiveFavorite';
import { useLivePlayer } from '@/features/live/hooks/useLivePlayer';
import { useLiveSources } from '@/features/live/hooks/useLiveSources';
import { useBackNavigation } from '@/hooks/useBackNavigation';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';

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
        <LoadingStatePanel
          icon={stage === 'ready' ? <CheckCircle2 /> : <Tv />}
          iconKey={stage === 'ready' ? 'ready' : 'loading'}
          loading={stage !== 'ready'}
          message={message}
          progress={progress}
        >
          <button
            type='button'
            onClick={onBack}
            aria-label='取消加载'
            className={MODAL_SECONDARY_BUTTON_CLASS}
          >
            取消
          </button>
        </LoadingStatePanel>
      </div>
    </PageLayout>
  );
}

function LiveErrorView({ error }: { error: string }) {
  const isAuthError = error.includes('登录');

  return (
    <PageLayout activePath='/live' contentMode='player' showDesktopBack={false}>
      <div className='flex h-full items-center justify-center'>
        <LoadingStatePanel
          icon={<AlertTriangle />}
          tone='red'
          title='直播加载失败'
          message={error}
          description={isAuthError ? undefined : '请检查网络连接或稍后重试。'}
        >
          {isAuthError ? null : (
            <button
              type='button'
              onClick={() => window.location.reload()}
              className={`gap-1.5 ${MODAL_PRIMARY_BUTTON_CLASS}`}
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
      <span className='inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-brand-700 ring-1 ring-brand-200/60 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-500/20'>
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
      <span className='inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-brand-700 ring-1 ring-brand-200/60 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-500/20'>
        共 {channelCount} 个频道
      </span>,
    );
  }

  return tags;
}

export function LivePlayerOverlay({
  unsupportedType,
  isVideoLoading,
  playbackFailed,
  onRetry,
}: {
  unsupportedType: string | null;
  isVideoLoading: boolean;
  playbackFailed: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      {playbackFailed && (
        <PlayerStateOverlay
          zClassName='z-[600]'
          icon={<AlertTriangle />}
          title='直播流加载失败'
          message='可以重试，或切换其他频道。'
        >
          <button
            type='button'
            onClick={onRetry}
            className={PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS}
          >
            <RefreshCw className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
            重试
          </button>
        </PlayerStateOverlay>
      )}

      {unsupportedType && (
        <PlayerStateOverlay
          zClassName='z-[600]'
          passThrough
          icon={<AlertTriangle />}
          tone='amber'
          title='暂不支持的直播流类型'
          message={`${unsupportedType.toUpperCase()}，目前仅支持 M3U8 格式，请尝试其他频道。`}
        />
      )}

      <PlayerStateOverlay
        visible={isVideoLoading}
        zClassName='z-[500]'
        passThrough
        loading
        title='正在连接直播流'
      />
    </>
  );
}

function AuthenticatedLivePageClient() {
  const goBack = useBackNavigation();
  const artRef = useRef<HTMLDivElement | null>(null);
  const groupContainerRef = useRef<HTMLDivElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);
  const cleanupPlayerRef = useRef<() => void>(() => {});

  const sources = useLiveSources({
    cleanupPlayer: () => cleanupPlayerRef.current(),
    channelListRef,
    groupContainerRef,
  });

  const { artPlayerRef, cleanupPlayer, playbackFailed, retryPlayback } =
    useLivePlayer({
      videoUrl: sources.videoUrl,
      currentChannel: sources.currentChannel,
      currentSourceRef: sources.currentSourceRef,
      loading: sources.loading,
      artRef,
      setIsVideoLoading: sources.setIsVideoLoading,
      setUnsupportedType: sources.setUnsupportedType,
    });

  cleanupPlayerRef.current = cleanupPlayer;
  usePlayerKeyboard({ artPlayerRef, mode: 'live' });

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
        onBack={goBack}
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
      isPanelCollapsed={sources.isChannelListCollapsed}
      onTogglePanel={() =>
        sources.setIsChannelListCollapsed(!sources.isChannelListCollapsed)
      }
      panelToggleTitle={
        sources.isChannelListCollapsed ? '显示直播面板' : '隐藏直播面板'
      }
      artRef={artRef}
      shortcutMode='live'
      titleSuffix={sources.currentChannel?.group || null}
      tags={headerTags}
      playerOverlay={
        <LivePlayerOverlay
          unsupportedType={sources.unsupportedType}
          isVideoLoading={sources.isVideoLoading}
          playbackFailed={playbackFailed}
          onRetry={retryPlayback}
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
      <AuthenticatedRoute
        activePath='/live'
        contentMode='player'
        showDesktopBack={false}
        message='请先登录后再观看直播。'
      >
        <AuthenticatedLivePageClient />
      </AuthenticatedRoute>
    </Suspense>
  );
}

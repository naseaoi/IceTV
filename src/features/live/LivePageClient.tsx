'use client';

import '@/features/live/types';
import '@/features/live/live.css';

import {
  AlertTriangle,
  CirclePause,
  ListVideo,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import { ListLoadingState } from '@/components/ListState';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import { MODAL_PRIMARY_BUTTON_CLASS } from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import PageLayout from '@/components/PageLayout';
import { PlayerPageLayout } from '@/components/PlayerPageLayout';
import { PLAYER_PANEL_SURFACE_CLASS } from '@/components/PlayerPanelTabBar';
import PlayerStateOverlay, {
  PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS,
} from '@/components/PlayerStateOverlay';
import SkeletonText from '@/components/SkeletonText';
import { LiveChannelActions } from '@/features/live/components/LiveChannelActions';
import { LiveChannelSidebar } from '@/features/live/components/LiveChannelSidebar';
import { useLiveFavorite } from '@/features/live/hooks/useLiveFavorite';
import { useLiveLineSelection } from '@/features/live/hooks/useLiveLineSelection';
import { useLivePlayer } from '@/features/live/hooks/useLivePlayer';
import { useLiveProgram } from '@/features/live/hooks/useLiveProgram';
import { useLiveSources } from '@/features/live/hooks/useLiveSources';
import {
  type LiveChannelGroup,
  groupLiveChannels,
  matchesLiveChannel,
} from '@/features/live/lib/liveChannelGroups';
import { LIVE_STARTUP_SLOW_MS } from '@/features/live/lib/liveInactivityPolicy';
import { formatTimeToHHMM } from '@/features/live/lib/time';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';

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
  relayPaused = false,
  onRetry,
  inactivityStopped,
  onResume,
  slowConnection = false,
  onSwitchLine,
  inactivityWarning = false,
  onContinueWatching,
}: {
  unsupportedType: string | null;
  isVideoLoading: boolean;
  playbackFailed: boolean;
  relayPaused?: boolean;
  onRetry: () => void;
  inactivityStopped: boolean;
  onResume: () => void;
  slowConnection?: boolean;
  onSwitchLine?: () => void;
  inactivityWarning?: boolean;
  onContinueWatching?: () => void;
}) {
  return (
    <>
      {inactivityStopped && (
        <PlayerStateOverlay
          zClassName='z-[600]'
          icon={<CirclePause />}
          tone='neutral'
          title='直播已暂停'
          message='长时间未操作，已停止播放。'
        >
          <button
            type='button'
            onClick={onResume}
            className={PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS}
          >
            <Play className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
            继续观看
          </button>
        </PlayerStateOverlay>
      )}

      {playbackFailed && (
        <PlayerStateOverlay
          zClassName='z-[600]'
          icon={<AlertTriangle />}
          title={relayPaused ? '服务器中转已暂停' : '直播流加载失败'}
          message={
            relayPaused
              ? '该频道无法直连播放，可切换其他频道。'
              : '可以重试，或切换其他频道。'
          }
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
        message={slowConnection ? '连接较慢' : undefined}
      >
        {slowConnection && onSwitchLine && (
          <button
            type='button'
            onClick={onSwitchLine}
            className={PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS}
          >
            换一条线路
          </button>
        )}
      </PlayerStateOverlay>
      {inactivityWarning && !inactivityStopped && (
        <div
          role='status'
          className='absolute right-14 top-3 z-[610] flex max-w-[calc(100%-4.5rem)] items-center gap-3 rounded-lg bg-black/90 px-3 py-2 text-xs text-white'
        >
          长时间无操作，即将停止播放
          <button
            type='button'
            onClick={onContinueWatching}
            className='rounded-full bg-white px-3 py-1 text-gray-900'
          >
            继续观看
          </button>
        </div>
      )}
    </>
  );
}

function AuthenticatedLivePageClient() {
  const artRef = useRef<HTMLDivElement | null>(null);
  const groupContainerRef = useRef<HTMLDivElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);
  const cleanupPlayerRef = useRef<() => void>(() => {});

  const sources = useLiveSources({
    cleanupPlayer: () => cleanupPlayerRef.current(),
    channelListRef,
    groupContainerRef,
  });

  const groups = useMemo(
    () => groupLiveChannels(sources.currentChannels),
    [sources.currentChannels],
  );
  const selection = useLiveLineSelection({
    groups,
    currentChannel: sources.currentChannel,
    currentSource: sources.currentSource,
    onChange: sources.handleChannelChange,
  });
  const [firstFrameKey, setFirstFrameKey] = useState('');
  const [slowConnection, setSlowConnection] = useState(false);
  const playbackKey = `${sources.currentSource?.key}:${sources.currentChannel?.id}`;
  useEffect(() => setFirstFrameKey(''), [playbackKey]);
  const player = useLivePlayer({
    videoUrl: sources.videoUrl,
    currentChannel: sources.currentChannel,
    currentSourceRef: sources.currentSourceRef,
    loading: sources.loading,
    artRef,
    setIsVideoLoading: sources.setIsVideoLoading,
    setUnsupportedType: sources.setUnsupportedType,
    onFirstFrame: (line, sourceKey) => {
      selection.onFirstFrame(line, sourceKey);
      setFirstFrameKey(`${sourceKey}:${line.id}`);
    },
    onPlaybackFailed: selection.onFailure,
  });
  cleanupPlayerRef.current = player.cleanupPlayer;
  const favorites = useLiveFavorite({
    currentSource: sources.currentSource,
    groups,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteFilter, setFavoriteFilter] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(
      '(orientation: landscape) and (max-width: 950px) and (max-height: 500px)',
    );
    const sync = () => {
      setLandscape(media.matches);
      if (!media.matches) setDrawerOpen(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    setSlowConnection(false);
    if (
      sources.loading ||
      !sources.currentChannel ||
      firstFrameKey === playbackKey ||
      player.playbackFailed ||
      player.inactivityStopped
    )
      return;
    const timer = window.setTimeout(
      () => setSlowConnection(true),
      LIVE_STARTUP_SLOW_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    sources.loading,
    sources.currentChannel,
    playbackKey,
    firstFrameKey,
    player.playbackFailed,
    player.inactivityStopped,
  ]);
  const groupedChannels = useMemo(() => {
    const result: Record<string, LiveChannelGroup[]> = {};
    for (const group of groups)
      (result[group.group || '其他'] ||= []).push(group);
    return result;
  }, [groups]);
  const filteredChannels = searchQuery.trim()
    ? groups.filter((group) => matchesLiveChannel(group, searchQuery))
    : favoriteFilter
      ? favorites.favoriteGroups
      : groupedChannels[sources.selectedGroup] || groups;
  const selectGroup = (group: LiveChannelGroup) => {
    selection.selectGroup(group);
    setDrawerOpen(false);
  };
  const changeChannel = (direction: number) => {
    if (!filteredChannels.length) return;
    const index = filteredChannels.findIndex(
      (group) => group.groupKey === selection.currentGroup?.groupKey,
    );
    selectGroup(
      filteredChannels[
        (index + direction + filteredChannels.length) % filteredChannels.length
      ],
    );
  };
  usePlayerKeyboard({
    artPlayerRef: player.artPlayerRef,
    mode: 'live',
    channelHandlers: {
      previous: () => changeChannel(-1),
      next: () => changeChannel(1),
    },
  });
  const program = useLiveProgram(sources.epgData);
  const programSummary = program.current
    ? `正在播放 ${program.current.title} ${formatTimeToHHMM(program.current.start)}–${formatTimeToHHMM(program.current.end)}${program.next ? ` · 接下来 ${program.next.title}` : ''}`
    : null;
  const sidebar = sources.loading ? (
    <div className={`flex h-full flex-col ${PLAYER_PANEL_SURFACE_CLASS}`}>
      <ListLoadingState className='min-h-0 flex-1 px-4 py-6' />
    </div>
  ) : (
    <LiveChannelSidebar
      activeTab={sources.activeTab}
      setActiveTab={sources.setActiveTab}
      isSwitchingSource={sources.isSwitchingSource}
      groupedChannels={
        favorites.favoriteGroups.length || favoriteFilter
          ? { 收藏: favorites.favoriteGroups, ...groupedChannels }
          : groupedChannels
      }
      selectedGroup={favoriteFilter ? '收藏' : sources.selectedGroup}
      filteredChannels={filteredChannels}
      currentChannel={sources.currentChannel}
      currentSource={sources.currentSource}
      liveSources={sources.liveSources}
      epgData={sources.epgData}
      isEpgLoading={sources.isEpgLoading}
      epgError={sources.epgError}
      retryEpg={sources.retryEpg}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      favoriteReady={favorites.ready}
      isGroupFavorited={favorites.isGroupFavorited}
      toggleGroupFavorite={favorites.toggleGroupFavorite}
      groupContainerRef={groupContainerRef}
      channelListRef={channelListRef}
      handleGroupChange={(group) => {
        setFavoriteFilter(group === '收藏');
        if (group !== '收藏') sources.handleGroupChange(group);
      }}
      handleChannelChange={selectGroup}
      handleSourceChange={(source) => {
        setFavoriteFilter(false);
        setSearchQuery('');
        void sources.handleSourceChange(source);
      }}
    />
  );

  const headerTags = useMemo(
    () =>
      buildLiveHeaderTags({
        sourceName: sources.currentSource?.name || '',
        groupName: sources.currentChannel?.group || '',
        channelCount: groups.length,
      }),
    [sources.currentChannel?.group, groups.length, sources.currentSource?.name],
  );

  if (sources.error) {
    return <LiveErrorView error={sources.error} />;
  }

  return (
    <PlayerPageLayout
      activePath='/live'
      title={selection.currentGroup?.name || sources.currentSource?.name || ''}
      titleFallback='直播'
      isPanelCollapsed={sources.isChannelListCollapsed}
      onTogglePanel={() =>
        sources.setIsChannelListCollapsed(!sources.isChannelListCollapsed)
      }
      artRef={artRef}
      shortcutMode='live'
      titleSuffix={selection.currentGroup?.group || null}
      titleActions={
        selection.currentGroup &&
        sources.currentChannel && (
          <LiveChannelActions
            group={selection.currentGroup}
            currentLine={sources.currentChannel}
            onSelectLine={selection.selectLine}
            favorited={favorites.isGroupFavorited(selection.currentGroup)}
            favoriteReady={favorites.ready}
            onFavorite={() => {
              if (selection.currentGroup)
                void favorites.toggleGroupFavorite(selection.currentGroup);
            }}
          />
        )
      }
      titleDescription={programSummary}
      tags={
        sources.loading
          ? [
              <SkeletonText
                key='loading'
                className='px-2.5 py-0.5 text-[11px] font-medium'
                barClassName='h-2.5 w-24 rounded'
              />,
            ]
          : headerTags
      }
      playerOverlay={
        <>
          {sources.loading ? (
            <PlayerStateOverlay
              loading
              title={sources.loadingMessage}
              zClassName='z-20'
            />
          ) : (
            <LivePlayerOverlay
              unsupportedType={sources.unsupportedType}
              isVideoLoading={
                sources.isVideoLoading ||
                Boolean(
                  sources.currentChannel &&
                  firstFrameKey !== playbackKey &&
                  !player.playbackFailed &&
                  !sources.unsupportedType &&
                  !player.inactivityStopped,
                )
              }
              playbackFailed={player.playbackFailed}
              relayPaused={player.relayPaused}
              onRetry={() => {
                setFirstFrameKey('');
                setSlowConnection(false);
                selection.retry(player.retryPlayback);
              }}
              inactivityStopped={player.inactivityStopped}
              onResume={() => {
                setFirstFrameKey('');
                player.resumeAfterInactivity();
              }}
              slowConnection={slowConnection}
              onSwitchLine={
                selection.nextLine ? selection.switchNext : undefined
              }
              inactivityWarning={player.inactivityWarning}
              onContinueWatching={player.continueWatching}
            />
          )}
          {landscape && (
            <button
              type='button'
              aria-label='打开频道列表'
              title='频道列表'
              onClick={() => {
                sources.setActiveTab('channels');
                setDrawerOpen(true);
              }}
              className='absolute right-3 top-3 z-[620] flex h-9 w-9 items-center justify-center rounded-full bg-black/80 text-white'
            >
              <ListVideo className='h-5 w-5' />
            </button>
          )}
          <ModalShell
            isOpen={landscape && drawerOpen}
            onClose={() => setDrawerOpen(false)}
            panelClassName='live-channel-drawer'
          >
            <div
              role='dialog'
              aria-label='频道列表'
              className='flex h-full flex-col'
            >
              <div className='flex shrink-0 items-center justify-between px-4 py-2 text-sm font-medium text-gray-900 dark:text-white'>
                频道列表
                <button
                  type='button'
                  aria-label='关闭频道列表'
                  onClick={() => setDrawerOpen(false)}
                  className='p-1'
                >
                  <X className='h-4 w-4' />
                </button>
              </div>
              <div className='min-h-0 flex-1'>{landscape ? sidebar : null}</div>
            </div>
          </ModalShell>
        </>
      }
      rightPanel={landscape ? null : sidebar}
    />
  );
}

export default function LivePage() {
  return (
    <Suspense fallback={<ListLoadingState className='py-12' />}>
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

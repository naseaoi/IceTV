import {
  Clock,
  LocateFixed,
  Radio,
  Search,
  Star,
  Target,
  Tv,
  X,
} from 'lucide-react';
import { MutableRefObject, useEffect, useRef, useState } from 'react';

import { FLOATING_CONTROL_CLASS } from '@/components/floating-control';
import { ListEmptyState, ListLoadingState } from '@/components/ListState';
import LoadErrorState from '@/components/LoadErrorState';
import {
  PLAYER_PANEL_SURFACE_CLASS,
  PlayerPanelContent,
  PlayerPanelTabBar,
} from '@/components/PlayerPanelTabBar';
import Spinner from '@/components/Spinner';
import { LiveLineHealthBadge } from '@/features/live/components/LiveLineHealthBadge';
import { useLiveProgram } from '@/features/live/hooks/useLiveProgram';
import {
  scrollToVerticalCenter,
  useVerticalScrollEdgeFade,
} from '@/features/live/hooks/useVerticalScrollEdgeFade';
import {
  type LiveChannelGroup,
  liveChannelGroupKey,
  sortLiveLines,
} from '@/features/live/lib/liveChannelGroups';
import { formatTimeToHHMM } from '@/features/live/lib/time';
import type {
  EpgData,
  LiveChannel,
  LivePanelTab,
  LiveSource,
} from '@/features/live/types';
import { readLiveLineResults } from '@/lib/live-line-results';

interface LiveChannelSidebarProps {
  activeTab: LivePanelTab;
  setActiveTab: (tab: LivePanelTab) => void;
  isSwitchingSource: boolean;
  groupedChannels: Record<string, LiveChannelGroup[]>;
  selectedGroup: string;
  filteredChannels: LiveChannelGroup[];
  currentChannel: LiveChannel | null;
  currentSource: LiveSource | null;
  liveSources: LiveSource[];
  epgData: EpgData | null;
  isEpgLoading: boolean;
  epgError?: string | null;
  retryEpg?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  favoriteReady: boolean;
  isGroupFavorited: (group: LiveChannelGroup) => boolean;
  toggleGroupFavorite: (group: LiveChannelGroup) => void;
  groupContainerRef: MutableRefObject<HTMLDivElement | null>;
  channelListRef: MutableRefObject<HTMLDivElement | null>;
  handleGroupChange: (group: string) => void;
  handleChannelChange: (channel: LiveChannelGroup) => void;
  handleSourceChange: (source: LiveSource) => void;
}

const EPG_STATE_CLASS = 'min-h-0 flex-1 px-4 py-6 text-center';

const tabs: { key: LivePanelTab; label: string }[] = [
  { key: 'channels', label: '频道' },
  { key: 'epg', label: '节目单' },
  { key: 'sources', label: '直播源' },
];

function ChannelLogo({
  channel,
  source,
  size = 'md',
}: {
  channel: LiveChannel | null;
  source: LiveSource | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass =
    size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-10 w-10' : 'h-11 w-11';

  return (
    <div
      className={`${sizeClass} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-700 dark:bg-gray-800`}
    >
      {channel?.logo ? (
        <img
          src={`/api/proxy/logo?url=${encodeURIComponent(channel.logo)}&source=${source?.key || ''}`}
          alt={channel.name}
          className='h-full w-full rounded object-contain'
          loading='lazy'
        />
      ) : (
        <Tv className='h-5 w-5 text-gray-400 dark:text-gray-500' />
      )}
    </div>
  );
}

function EpgTab({
  currentChannel,
  currentSource,
  epgData,
  isEpgLoading,
  epgError,
  retryEpg,
}: Pick<
  LiveChannelSidebarProps,
  | 'currentChannel'
  | 'currentSource'
  | 'epgData'
  | 'isEpgLoading'
  | 'epgError'
  | 'retryEpg'
>) {
  const { currentIndex } = useLiveProgram(epgData);
  const programs = epgData?.programs || [];
  const programListRef = useRef<HTMLDivElement | null>(null);
  const currentProgramRef = useRef<HTMLDivElement | null>(null);
  const programScrollFade = useVerticalScrollEdgeFade({
    externalRef: programListRef,
    refreshKey: `${currentChannel?.id || ''}:${programs.length}`,
  });

  useEffect(() => {
    if (currentIndex === -1) {
      return;
    }

    const timer = window.setTimeout(() => {
      const list = programListRef.current;
      const item = currentProgramRef.current;
      if (!list || !item) {
        return;
      }

      scrollToVerticalCenter(list, item);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [currentChannel?.id, currentIndex, programs.length]);

  if (!currentChannel) {
    return (
      <ListEmptyState
        icon={<Tv />}
        label='请先选择一个直播频道'
        className={EPG_STATE_CLASS}
      />
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex flex-shrink-0 items-center gap-3 border-b border-gray-200/80 p-4 dark:border-white/10'>
        <ChannelLogo
          channel={currentChannel}
          source={currentSource}
          size='lg'
        />
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
            {currentChannel.name}
          </div>
          <div className='mt-1 truncate text-xs text-gray-500 dark:text-gray-400'>
            {[currentSource?.name, currentChannel.group]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>

      {isEpgLoading ? (
        <ListLoadingState label='加载节目单...' className={EPG_STATE_CLASS} />
      ) : epgError ? (
        <LoadErrorState message={epgError} onRetry={() => retryEpg?.()} />
      ) : programs.length === 0 ? (
        <ListEmptyState
          icon={<Clock />}
          label='暂无节目单'
          className={EPG_STATE_CLASS}
        />
      ) : (
        <div
          ref={programScrollFade.ref}
          data-live-scroll-panel='epg'
          data-top-fade={programScrollFade.hasTopFade}
          data-bottom-fade={programScrollFade.hasBottomFade}
          className='min-h-0 flex-1 overflow-y-auto p-3'
          onScroll={programScrollFade.onScroll}
          style={programScrollFade.style}
        >
          <div className='space-y-2'>
            {programs.map((program, index) => {
              const isCurrent = index === currentIndex;
              const isFinished = currentIndex !== -1 && index < currentIndex;

              return (
                <div
                  key={`${program.start}-${program.title}-${index}`}
                  ref={isCurrent ? currentProgramRef : undefined}
                  className={`rounded-lg border p-3 transition-colors ${
                    isCurrent
                      ? 'border-brand-500/30 bg-brand-500/10 dark:bg-brand-500/20'
                      : isFinished
                        ? 'border-gray-200 bg-gray-100/70 dark:border-gray-700 dark:bg-gray-800/70'
                        : 'border-brand-500/20 bg-brand-500/10 dark:bg-brand-500/20'
                  }`}
                >
                  <div className='mb-2 flex items-center justify-between text-xs'>
                    <span
                      className={
                        isCurrent
                          ? 'font-medium text-brand-600 dark:text-brand-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }
                    >
                      {formatTimeToHHMM(program.start)}
                    </span>
                    <span className='text-gray-400 dark:text-gray-500'>
                      {formatTimeToHHMM(program.end)}
                    </span>
                  </div>
                  <div
                    className={`line-clamp-2 text-sm font-medium ${
                      isCurrent
                        ? 'text-brand-900 dark:text-brand-100'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                    title={program.title}
                  >
                    {program.title}
                  </div>
                  {isCurrent && (
                    <div className='mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400'>
                      <Target className='h-3 w-3' />
                      正在播放
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function LiveChannelSidebar({
  activeTab,
  setActiveTab,
  isSwitchingSource,
  groupedChannels,
  selectedGroup,
  filteredChannels,
  currentChannel,
  currentSource,
  liveSources,
  epgData,
  isEpgLoading,
  epgError,
  retryEpg,
  groupContainerRef,
  channelListRef,
  handleGroupChange,
  handleChannelChange,
  handleSourceChange,
  searchQuery,
  onSearchChange,
  favoriteReady,
  isGroupFavorited,
  toggleGroupFavorite,
}: LiveChannelSidebarProps) {
  const groupButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const channelScrollFade = useVerticalScrollEdgeFade({
    externalRef: channelListRef,
    refreshKey: `${selectedGroup}:${filteredChannels.length}`,
  });
  const sourceScrollFade = useVerticalScrollEdgeFade({
    refreshKey: liveSources.length,
  });

  useEffect(() => {
    if (!selectedGroup || !groupContainerRef.current) return;

    const groupKeys = Object.keys(groupedChannels);
    const groupIndex = groupKeys.indexOf(selectedGroup);
    if (groupIndex === -1) return;

    const button = groupButtonRefs.current[groupIndex];
    const container = groupContainerRef.current;
    if (!button || !container) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const buttonLeft =
      buttonRect.left - containerRect.left + container.scrollLeft;
    const targetScrollLeft =
      buttonLeft - (containerRect.width - buttonRect.width) / 2;
    container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
  }, [selectedGroup, groupedChannels, groupContainerRef]);

  const currentRowRef = useRef<HTMLDivElement | null>(null);
  const [currentVisible, setCurrentVisible] = useState(true);
  const currentKey = currentChannel
    ? liveChannelGroupKey(currentChannel.name)
    : '';
  useEffect(() => {
    const row = currentRowRef.current;
    const root = channelListRef.current;
    if (!row || !root || typeof IntersectionObserver === 'undefined') {
      setCurrentVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setCurrentVisible(entry.isIntersecting),
      { root, threshold: 0.8 },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [activeTab, currentKey, filteredChannels, channelListRef]);
  const localResults = readLiveLineResults();

  return (
    <div className={`flex h-full flex-col ${PLAYER_PANEL_SURFACE_CLASS}`}>
      <PlayerPanelTabBar
        tabs={tabs}
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel='直播面板标签'
      />

      <PlayerPanelContent>
        {activeTab === 'channels' && (
          <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
            <div className='px-3 pt-3'>
              <div className='flex items-center gap-2 rounded-lg bg-gray-100 px-3 dark:bg-gray-800'>
                <Search className='h-4 w-4 shrink-0 text-gray-400' />
                <input
                  name='live-channel-search'
                  aria-label='搜索频道'
                  placeholder='搜索频道'
                  value={searchQuery}
                  onChange={(event) => onSearchChange(event.target.value)}
                  className='min-w-0 flex-1 border-0 bg-transparent px-0 py-2 text-sm text-gray-900 focus:ring-0 dark:text-gray-100'
                />
                {searchQuery && (
                  <button
                    type='button'
                    aria-label='清空搜索'
                    onClick={() => onSearchChange('')}
                    className='p-1 text-gray-500'
                  >
                    <X className='h-4 w-4' />
                  </button>
                )}
              </div>
            </div>
            {!searchQuery.trim() && (
              <div className='flex flex-shrink-0 items-center gap-3 border-b border-gray-200/70 px-3 py-2.5 dark:border-white/[0.06]'>
                {isSwitchingSource && (
                  <div className='flex items-center gap-2 whitespace-nowrap text-xs text-amber-600 dark:text-amber-400'>
                    <Spinner className='h-3 w-3' strokeWidth={6} />
                    切换中
                  </div>
                )}
                <div
                  ref={groupContainerRef}
                  className='min-w-0 flex-1 overflow-x-auto'
                >
                  <div className='flex min-w-max gap-1'>
                    {Object.keys(groupedChannels).map((group, index) => (
                      <button
                        key={group}
                        data-group={group}
                        ref={(el) => {
                          groupButtonRefs.current[index] = el;
                        }}
                        onClick={() => handleGroupChange(group)}
                        disabled={isSwitchingSource}
                        className={`max-w-[8rem] flex-shrink-0 rounded-full px-3 py-1 text-[13px] transition-colors ${
                          isSwitchingSource
                            ? 'cursor-not-allowed text-gray-400 opacity-50 dark:text-gray-600'
                            : selectedGroup === group
                              ? 'bg-gray-900/[0.07] font-medium text-gray-900 dark:bg-white/[0.1] dark:text-white'
                              : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                        }`}
                        title={group}
                      >
                        <span className='block truncate'>
                          {group}{' '}
                          <span className='ml-1 tabular-nums text-gray-400'>
                            {groupedChannels[group].length}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div
              ref={channelScrollFade.ref}
              data-live-scroll-panel='channels'
              data-top-fade={channelScrollFade.hasTopFade}
              data-bottom-fade={channelScrollFade.hasBottomFade}
              className={`max-h-[50dvh] min-h-0 flex-1 overflow-y-auto p-2 md:max-h-none ${
                filteredChannels.length > 0 ? 'space-y-0.5' : 'flex flex-col'
              }`}
              onScroll={channelScrollFade.onScroll}
              style={channelScrollFade.style}
            >
              {filteredChannels.length > 0 ? (
                filteredChannels.map((channel) => {
                  const isActive = channel.groupKey === currentKey;
                  const favorited = isGroupFavorited(channel);
                  const best = sortLiveLines(channel.lines, localResults)[0];
                  return (
                    <div
                      key={channel.groupKey}
                      ref={isActive ? currentRowRef : undefined}
                      data-channel-id={channel.id}
                      data-channel-group={channel.groupKey}
                      className={`group flex items-center rounded-lg transition-colors ${isActive ? 'bg-brand-500/10 dark:bg-brand-400/10' : 'hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.05]'}`}
                    >
                      <button
                        type='button'
                        onClick={() => handleChannelChange(channel)}
                        disabled={isSwitchingSource}
                        aria-current={isActive ? 'true' : undefined}
                        className='flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left disabled:opacity-50'
                      >
                        <ChannelLogo
                          channel={channel}
                          source={currentSource}
                          size='sm'
                        />
                        <div className='min-w-0 flex-1'>
                          <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                            {channel.name}
                          </div>
                          <div className='mt-1 truncate text-xs text-gray-500 dark:text-gray-400'>
                            <LiveLineHealthBadge line={best} />
                            {channel.lines.length > 1 &&
                              ` · ${channel.lines.length} 条线路`}
                          </div>
                        </div>
                      </button>
                      <button
                        type='button'
                        aria-label={`${favorited ? '取消收藏' : '收藏'} ${channel.name}`}
                        aria-pressed={favorited}
                        disabled={!favoriteReady || isSwitchingSource}
                        onClick={() => toggleGroupFavorite(channel)}
                        className={`live-channel-favorite mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 ${favorited ? 'text-amber-600 dark:text-amber-400' : 'live-channel-favorite-idle text-gray-400 dark:text-gray-500'}`}
                      >
                        <Star
                          className={`h-4 w-4 ${favorited ? 'fill-current' : ''}`}
                        />
                      </button>
                    </div>
                  );
                })
              ) : (
                <ListEmptyState
                  icon={<Tv />}
                  label={searchQuery.trim() ? '未找到频道' : '暂无可用频道'}
                  className={EPG_STATE_CLASS}
                />
              )}
            </div>
            {!currentVisible && (
              <button
                type='button'
                title='定位当前'
                aria-label='定位当前'
                className={`${FLOATING_CONTROL_CLASS} absolute bottom-4 right-4 h-10 w-10`}
                onClick={() => {
                  if (channelListRef.current && currentRowRef.current)
                    scrollToVerticalCenter(
                      channelListRef.current,
                      currentRowRef.current,
                    );
                }}
              >
                <LocateFixed className='h-4 w-4' />
              </button>
            )}
          </div>
        )}

        {activeTab === 'epg' && (
          <EpgTab
            currentChannel={currentChannel}
            currentSource={currentSource}
            epgData={epgData}
            isEpgLoading={isEpgLoading}
            epgError={epgError}
            retryEpg={retryEpg}
          />
        )}

        {activeTab === 'sources' && (
          <div
            ref={sourceScrollFade.ref}
            data-live-scroll-panel='sources'
            data-top-fade={sourceScrollFade.hasTopFade}
            data-bottom-fade={sourceScrollFade.hasBottomFade}
            className={`min-h-0 flex-1 overflow-y-auto ${
              liveSources.length > 0 ? 'p-3' : 'flex flex-col'
            }`}
            onScroll={sourceScrollFade.onScroll}
            style={sourceScrollFade.style}
          >
            {liveSources.length > 0 ? (
              <div className='space-y-2'>
                {liveSources.map((source) => {
                  const isCurrentSource = source.key === currentSource?.key;
                  return (
                    <button
                      key={source.key}
                      onClick={() => {
                        if (!isCurrentSource) handleSourceChange(source);
                      }}
                      className={`relative flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-all duration-200 ${
                        isCurrentSource
                          ? 'bg-brand-500/10 dark:bg-brand-400/10'
                          : 'hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className='flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900/[0.05] dark:bg-white/[0.06]'>
                        <Radio className='h-5 w-5 text-gray-500' />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {source.name}
                        </div>
                        <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                          {!source.channelNumber || source.channelNumber === 0
                            ? '-'
                            : `${source.channelNumber} 条线路`}
                        </div>
                      </div>
                      {isCurrentSource && (
                        <div className='absolute right-3 top-3 h-2 w-2 rounded-full bg-brand-500' />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <ListEmptyState
                icon={<Radio />}
                label='暂无可用直播源'
                className={EPG_STATE_CLASS}
              />
            )}
          </div>
        )}
      </PlayerPanelContent>
    </div>
  );
}

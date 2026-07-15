import { Clock, Heart, Radio, Target, Tv } from 'lucide-react';
import { MutableRefObject, ReactNode, useEffect, useMemo, useRef } from 'react';

import {
  PlayerPanelContent,
  PlayerPanelTabBar,
} from '@/components/PlayerPanelTabBar';
import {
  formatTimeToHHMM,
  parseCustomTimeFormat,
} from '@/features/live/lib/time';

import type {
  EpgData,
  EpgProgram,
  LiveChannel,
  LivePanelTab,
  LiveSource,
} from '../types';

interface LiveChannelSidebarProps {
  activeTab: LivePanelTab;
  setActiveTab: (tab: LivePanelTab) => void;
  isSwitchingSource: boolean;
  groupedChannels: Record<string, LiveChannel[]>;
  selectedGroup: string;
  filteredChannels: LiveChannel[];
  currentChannel: LiveChannel | null;
  currentSource: LiveSource | null;
  liveSources: LiveSource[];
  epgData: EpgData | null;
  isEpgLoading: boolean;
  favorited: boolean;
  handleToggleFavorite: () => void;
  groupContainerRef: MutableRefObject<HTMLDivElement | null>;
  channelListRef: MutableRefObject<HTMLDivElement | null>;
  handleGroupChange: (group: string) => void;
  handleChannelChange: (channel: LiveChannel) => void;
  handleSourceChange: (source: LiveSource) => void;
}

const tabs: { key: LivePanelTab; label: string }[] = [
  { key: 'channels', label: '频道' },
  { key: 'epg', label: '节目单' },
  { key: 'sources', label: '直播源' },
];

function isProgramLive(program: EpgProgram, currentTime: Date) {
  try {
    const start = parseCustomTimeFormat(program.start);
    const end = parseCustomTimeFormat(program.end);
    return currentTime >= start && currentTime < end;
  } catch {
    return false;
  }
}

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
      className={`${sizeClass} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800`}
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

function EmptyPanel({
  icon,
  title,
  message,
}: {
  icon: ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center'>
      <div className='mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800'>
        {icon}
      </div>
      <p className='font-medium text-gray-500 dark:text-gray-400'>{title}</p>
      <p className='mt-1 text-sm text-gray-400 dark:text-gray-500'>{message}</p>
    </div>
  );
}

function EpgTab({
  currentChannel,
  currentSource,
  epgData,
  isEpgLoading,
  favorited,
  handleToggleFavorite,
}: Pick<
  LiveChannelSidebarProps,
  | 'currentChannel'
  | 'currentSource'
  | 'epgData'
  | 'isEpgLoading'
  | 'favorited'
  | 'handleToggleFavorite'
>) {
  const currentTime = useMemo(() => new Date(), []);
  const programs = epgData?.programs || [];
  const currentIndex = programs.findIndex((program) =>
    isProgramLive(program, currentTime),
  );
  const programListRef = useRef<HTMLDivElement | null>(null);
  const currentProgramRef = useRef<HTMLDivElement | null>(null);

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

      const top =
        item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2;
      list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [currentChannel?.id, currentIndex, programs.length]);

  if (!currentChannel) {
    return (
      <EmptyPanel
        icon={<Tv className='h-8 w-8 text-gray-400 dark:text-gray-600' />}
        title='未选择频道'
        message='请先选择一个直播频道'
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
        <button
          onClick={handleToggleFavorite}
          className='flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-500 dark:text-gray-300 dark:hover:bg-white/10'
          title={favorited ? '取消收藏' : '收藏'}
        >
          <Heart
            className={`h-5 w-5 ${favorited ? 'fill-red-500 text-red-500' : ''}`}
          />
        </button>
      </div>

      {isEpgLoading ? (
        <div className='flex min-h-0 flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400'>
          <div className='mr-3 h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500' />
          加载节目单...
        </div>
      ) : programs.length === 0 ? (
        <EmptyPanel
          icon={<Clock className='h-8 w-8 text-gray-400 dark:text-gray-600' />}
          title='暂无节目单'
          message='当前频道未提供节目单数据'
        />
      ) : (
        <div
          ref={programListRef}
          className='min-h-0 flex-1 overflow-y-auto p-3'
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
                      ? 'border-green-500/30 bg-green-500/10 dark:bg-green-500/20'
                      : isFinished
                        ? 'border-gray-200 bg-gray-100/70 dark:border-gray-700 dark:bg-gray-800/70'
                        : 'border-blue-500/20 bg-blue-500/10 dark:bg-blue-500/20'
                  }`}
                >
                  <div className='mb-2 flex items-center justify-between text-xs'>
                    <span
                      className={
                        isCurrent
                          ? 'font-medium text-green-600 dark:text-green-400'
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
                        ? 'text-green-900 dark:text-green-100'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                    title={program.title}
                  >
                    {program.title}
                  </div>
                  {isCurrent && (
                    <div className='mt-2 flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400'>
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
  favorited,
  handleToggleFavorite,
  groupContainerRef,
  channelListRef,
  handleGroupChange,
  handleChannelChange,
  handleSourceChange,
}: LiveChannelSidebarProps) {
  const groupButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  return (
    <div className='flex h-full flex-col overflow-hidden md:ml-1'>
      <PlayerPanelTabBar
        tabs={tabs}
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel='直播面板标签'
      />

      <PlayerPanelContent>
        {activeTab === 'channels' && (
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <div className='flex flex-shrink-0 items-center gap-3 border-b border-gray-200/80 px-4 dark:border-white/10'>
              {isSwitchingSource && (
                <div className='flex items-center gap-2 whitespace-nowrap text-xs text-amber-600 dark:text-amber-400'>
                  <div className='h-2 w-2 animate-pulse rounded-full bg-amber-500' />
                  切换中
                </div>
              )}
              <div
                ref={groupContainerRef}
                className='min-w-0 flex-1 overflow-x-auto'
              >
                <div className='flex min-w-max gap-3'>
                  {Object.keys(groupedChannels).map((group, index) => (
                    <button
                      key={group}
                      data-group={group}
                      ref={(el) => {
                        groupButtonRefs.current[index] = el;
                      }}
                      onClick={() => handleGroupChange(group)}
                      disabled={isSwitchingSource}
                      className={`relative w-20 flex-shrink-0 overflow-hidden py-3 text-center text-sm font-medium transition-colors ${
                        isSwitchingSource
                          ? 'cursor-not-allowed text-gray-400 opacity-50 dark:text-gray-600'
                          : selectedGroup === group
                            ? 'text-green-500 dark:text-green-400'
                            : 'text-gray-600 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                      }`}
                      title={group}
                    >
                      <span className='block truncate px-1'>{group}</span>
                      {selectedGroup === group && !isSwitchingSource && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-green-500 dark:bg-green-400' />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              ref={channelListRef}
              className={`max-h-[50dvh] min-h-0 flex-1 overflow-y-auto p-3 md:max-h-none ${
                filteredChannels.length > 0 ? 'space-y-2' : 'flex flex-col'
              }`}
            >
              {filteredChannels.length > 0 ? (
                filteredChannels.map((channel) => {
                  const isActive = channel.id === currentChannel?.id;
                  return (
                    <button
                      key={channel.id}
                      data-channel-id={channel.id}
                      onClick={() => handleChannelChange(channel)}
                      disabled={isSwitchingSource}
                      className={`w-full rounded-lg p-3 text-left transition-all duration-200 ${
                        isSwitchingSource
                          ? 'cursor-not-allowed opacity-50'
                          : isActive
                            ? 'border border-green-300 bg-green-100 dark:border-green-700 dark:bg-green-900/30'
                            : 'hover:bg-gray-100 dark:hover:bg-white/10'
                      }`}
                    >
                      <div className='flex items-center gap-3'>
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
                            {channel.group}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <EmptyPanel
                  icon={
                    <Tv className='h-8 w-8 text-gray-400 dark:text-gray-600' />
                  }
                  title='暂无可用频道'
                  message='请选择其他直播源或稍后再试'
                />
              )}
            </div>
          </div>
        )}

        {activeTab === 'epg' && (
          <EpgTab
            currentChannel={currentChannel}
            currentSource={currentSource}
            epgData={epgData}
            isEpgLoading={isEpgLoading}
            favorited={favorited}
            handleToggleFavorite={handleToggleFavorite}
          />
        )}

        {activeTab === 'sources' && (
          <div
            className={`min-h-0 flex-1 overflow-y-auto ${
              liveSources.length > 0 ? 'p-3' : 'flex flex-col'
            }`}
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
                          ? 'border border-green-500/30 bg-green-500/10 dark:bg-green-500/20'
                          : 'hover:bg-gray-100 dark:hover:bg-white/10'
                      }`}
                    >
                      <div className='flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800'>
                        <Radio className='h-5 w-5 text-gray-500' />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {source.name}
                        </div>
                        <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                          {!source.channelNumber || source.channelNumber === 0
                            ? '-'
                            : `${source.channelNumber} 个频道`}
                        </div>
                      </div>
                      {isCurrentSource && (
                        <div className='absolute right-3 top-3 h-2 w-2 rounded-full bg-green-500' />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyPanel
                icon={
                  <Radio className='h-8 w-8 text-gray-400 dark:text-gray-600' />
                }
                title='暂无可用直播源'
                message='请检查网络连接或联系管理员添加直播源'
              />
            )}
          </div>
        )}
      </PlayerPanelContent>
    </div>
  );
}

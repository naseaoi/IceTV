'use client';

import '@/features/live/live.css';

import { useRef, useState } from 'react';

import { ListLoadingState } from '@/components/ListState';
import { PlayerPageLayout } from '@/components/PlayerPageLayout';
import { PLAYER_PANEL_SURFACE_CLASS } from '@/components/PlayerPanelTabBar';
import PlayerStateOverlay from '@/components/PlayerStateOverlay';
import SkeletonText from '@/components/SkeletonText';
import { LiveChannelActionsSkeleton } from '@/features/live/components/LiveChannelActions';

export function LiveHeaderTagsSkeleton() {
  return (
    <SkeletonText
      className='px-2.5 py-0.5 text-[11px] font-medium'
      barClassName='h-2.5 w-24 rounded'
    />
  );
}

// 字号与行高继承 PlayerPageLayout 的节目摘要行
export function LiveHeaderDescriptionSkeleton() {
  return <SkeletonText barClassName='h-3 w-56 max-w-full rounded' />;
}

export function LiveSidebarLoading() {
  return (
    <div className={`flex h-full flex-col ${PLAYER_PANEL_SURFACE_CLASS}`}>
      <ListLoadingState className='min-h-0 flex-1 px-4 py-6' />
    </div>
  );
}

export default function LivePageLoading() {
  const artRef = useRef<HTMLDivElement | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  return (
    <PlayerPageLayout
      activePath='/live'
      title=''
      titleFallback='直播'
      isPanelCollapsed={isPanelCollapsed}
      onTogglePanel={() => setIsPanelCollapsed((collapsed) => !collapsed)}
      artRef={artRef}
      shortcutMode='live'
      titleActions={<LiveChannelActionsSkeleton />}
      titleDescription={<LiveHeaderDescriptionSkeleton />}
      tags={[<LiveHeaderTagsSkeleton key='loading' />]}
      playerOverlay={
        <PlayerStateOverlay loading title='加载直播' zClassName='z-20' />
      }
      rightPanel={<LiveSidebarLoading />}
    />
  );
}

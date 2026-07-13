import { ArrowLeftRight, Heart, LayoutGrid } from 'lucide-react';
import dynamic from 'next/dynamic';
import React, { useMemo, useState } from 'react';

import MobileSheet from '@/components/mobile/MobileSheet';
import { PlayerPanelContent } from '@/components/PlayerPanelTabBar';
import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';
import { TabBar } from '@/features/play/components/EpisodeSelector/TabBar';
import { getSourceBundle } from '@/lib/source-bundle';
import { normalizeTitleForSourceMatch } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';

const infoSkeletonLineWidths = [
  'w-full',
  'w-[96%]',
  'w-[92%]',
  'w-[98%]',
  'w-[88%]',
  'w-[94%]',
  'w-[84%]',
  'w-[90%]',
  'w-[72%]',
];

function EpisodeTabLoading() {
  return (
    <div className='flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-gray-500 dark:text-gray-400'>
      加载中...
    </div>
  );
}

function InfoTabLoading() {
  return (
    <div className='flex min-h-0 flex-col gap-2 px-5 pb-1 pt-4 sm:px-6 sm:pb-1 sm:pt-5'>
      <div className='flex flex-shrink-0 gap-4 sm:gap-5'>
        <div className='aspect-[2/3] w-24 flex-shrink-0 animate-pulse rounded-xl bg-gray-200/80 dark:bg-white/[0.08] sm:w-28 xl:w-32' />
        <div className='flex min-w-0 flex-1 flex-col justify-end gap-2.5 pb-0.5'>
          <div className='h-5 w-2/3 animate-pulse rounded-md bg-gray-200/80 dark:bg-white/[0.08]' />
          <div className='h-4 w-12 animate-pulse rounded-md bg-gray-200/80 dark:bg-white/[0.08]' />
          <div className='h-5 w-20 animate-pulse rounded-full bg-emerald-100/80 dark:bg-emerald-900/25' />
          <div className='flex gap-1.5'>
            <div className='h-5 w-14 animate-pulse rounded-full bg-gray-200/80 dark:bg-white/[0.08]' />
            <div className='h-5 w-20 animate-pulse rounded-full bg-violet-100/80 dark:bg-violet-900/25' />
          </div>
          <div className='flex gap-1.5'>
            <div className='h-5 w-16 animate-pulse rounded-full bg-blue-100/80 dark:bg-blue-900/25' />
          </div>
        </div>
      </div>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden'>
          {infoSkeletonLineWidths.map((widthClass, index) => (
            <div
              key={index}
              className={`h-[18px] flex-shrink-0 animate-pulse rounded bg-gray-200/70 dark:bg-white/[0.07] ${widthClass}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EpisodesTabLoading() {
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-shrink-0 gap-1 px-5 pb-2 pt-2 sm:px-6'>
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className='h-7 flex-1 animate-pulse rounded-md bg-gray-200/70 dark:bg-white/[0.07]'
          />
        ))}
      </div>
      <div className='flex flex-1 flex-wrap content-start justify-center gap-2 overflow-hidden px-5 pb-5 pt-2 sm:px-6 sm:pb-6'>
        {Array.from({ length: 24 }, (_, index) => (
          <div
            key={index}
            className='h-11 w-12 animate-pulse rounded-lg bg-gray-200/70 dark:bg-white/[0.07]'
          />
        ))}
      </div>
    </div>
  );
}

function pickDoubanId(
  candidates: SearchResult[],
  targetTitle: string,
  totalEpisodes: number,
) {
  const normalizedTarget = normalizeTitleForSourceMatch(targetTitle);
  if (!normalizedTarget) return 0;

  const counts = new Map<number, number>();
  for (const candidate of candidates) {
    const doubanId = candidate.douban_id || 0;
    if (doubanId <= 0) continue;
    if (normalizeTitleForSourceMatch(candidate.title) !== normalizedTarget) {
      continue;
    }

    const episodeCount = Math.max(
      candidate.episodes?.length || 0,
      candidate.episodes_titles?.length || 0,
    );
    if (
      totalEpisodes > 0 &&
      episodeCount > 0 &&
      episodeCount !== totalEpisodes
    ) {
      continue;
    }

    counts.set(doubanId, (counts.get(doubanId) || 0) + 1);
  }

  let selected = 0;
  let selectedCount = 0;
  counts.forEach((count, doubanId) => {
    if (count > selectedCount) {
      selected = doubanId;
      selectedCount = count;
    }
  });
  return selected;
}

const EpisodesTab = dynamic(
  () => import('./EpisodesTab.js').then((mod) => mod.EpisodesTab),
  { loading: EpisodesTabLoading },
);
const InfoTab = dynamic(
  () => import('./InfoTab.js').then((mod) => mod.InfoTab),
  {
    loading: InfoTabLoading,
  },
);
const SourcesTab = dynamic(
  () => import('./SourcesTab.js').then((mod) => mod.SourcesTab),
  { loading: EpisodeTabLoading },
);

interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

interface EpisodeSelectorProps {
  totalEpisodes: number;
  episodes_titles: string[];
  episodesPerPage?: number;
  value?: number;
  onChange?: (episodeNumber: number) => void;
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  searchKeyword?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  precomputedVideoInfo?: Map<string, VideoInfo>;
  detail?: SearchResult | null;
  videoYear?: string;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  videoCover?: string;
  videoDoubanId?: number;
  onSourceDetailFetched?: (updated: SearchResult) => void;
  onAddSources?: (newSources: SearchResult[]) => void;
}

type MobileSheetKey = 'episodes' | 'sources';
type DesktopTabKey = 'main' | 'sources';

const MOBILE_EPISODE_STRIP_SIZE = 12;

const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  searchKeyword,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
  detail = null,
  videoYear = '',
  favorited = false,
  onToggleFavorite,
  videoCover = '',
  videoDoubanId = 0,
  onSourceDetailFetched,
  onAddSources,
}) => {
  const variantSources = useMemo(() => {
    if (!detail) {
      return [];
    }

    return getSourceBundle(detail);
  }, [detail]);

  const resolvedDoubanId = useMemo(() => {
    if (videoDoubanId > 0) return videoDoubanId;
    if (detail?.douban_id && detail.douban_id > 0) return detail.douban_id;

    return pickDoubanId(
      [detail, ...variantSources, ...availableSources].filter(
        Boolean,
      ) as SearchResult[],
      detail?.title || videoTitle || '',
      totalEpisodes,
    );
  }, [
    availableSources,
    detail,
    totalEpisodes,
    variantSources,
    videoDoubanId,
    videoTitle,
  ]);

  const hasEpisodesTab = totalEpisodes > 1 || variantSources.length > 1;

  const [mobileSheet, setMobileSheet] = useState<MobileSheetKey | null>(null);
  const [desktopTab, setDesktopTab] = useState<DesktopTabKey>('main');

  const stripEpisodes = useMemo(() => {
    if (totalEpisodes <= 1) {
      return [];
    }

    const start = Math.max(
      1,
      Math.min(value - 3, totalEpisodes - MOBILE_EPISODE_STRIP_SIZE + 1),
    );
    const end = Math.min(totalEpisodes, start + MOBILE_EPISODE_STRIP_SIZE - 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [totalEpisodes, value]);

  const desktopTabs: { key: DesktopTabKey; label: string }[] = [
    { key: 'main', label: '详情' },
    { key: 'sources', label: '换源' },
  ];

  const renderEpisodesTab = (afterSelect?: () => void) => (
    <EpisodesTab
      totalEpisodes={totalEpisodes}
      episodes_titles={episodes_titles}
      episodesPerPage={episodesPerPage}
      value={value}
      onChange={(episodeNumber) => {
        onChange?.(episodeNumber);
        afterSelect?.();
      }}
      episodeGroups={detail?.episode_groups}
      variantSources={variantSources}
      currentSource={currentSource}
      currentId={currentId}
      onSourceChange={(source, id, title) => {
        onSourceChange?.(source, id, title);
        afterSelect?.();
      }}
    />
  );

  const renderInfoTab = (scrollMode: 'panel' | 'desc') => (
    <InfoTab
      videoTitle={videoTitle || ''}
      totalEpisodes={totalEpisodes}
      detail={detail}
      videoYear={videoYear}
      favorited={favorited}
      onToggleFavorite={onToggleFavorite || (() => {})}
      videoCover={videoCover}
      videoDoubanId={resolvedDoubanId}
      scrollMode={scrollMode}
    />
  );

  const renderSourcesTab = (afterSelect?: () => void) => (
    <div className='flex min-h-0 flex-1 flex-col'>
      <SourcesTab
        availableSources={availableSources}
        sourceSearchLoading={sourceSearchLoading}
        sourceSearchError={sourceSearchError}
        isActive={true}
        currentSource={currentSource}
        currentId={currentId}
        currentEpisodeIndex={Math.max(0, value - 1)}
        videoTitle={videoTitle}
        searchKeyword={searchKeyword}
        onSourceChange={(source, id, title) => {
          onSourceChange?.(source, id, title);
          afterSelect?.();
        }}
        precomputedVideoInfo={precomputedVideoInfo}
        activeDetail={detail}
        onSourceDetailFetched={onSourceDetailFetched}
        onAddSources={onAddSources}
      />
    </div>
  );

  const mobileActionButtonClass =
    'flex h-9 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200';

  return (
    <div className='flex h-full flex-col overflow-hidden md:ml-1'>
      <div className='flex min-h-0 flex-1 flex-col md:hidden'>
        <div className='flex items-center justify-between gap-2 py-1'>
          <span className='min-w-0 truncate text-sm text-gray-600 dark:text-gray-300'>
            {totalEpisodes > 1
              ? `第 ${value} 集 / 共 ${totalEpisodes} 集`
              : '正片'}
          </span>
          <div className='flex shrink-0 items-center gap-1.5'>
            {onToggleFavorite && (
              <button
                type='button'
                aria-label={favorited ? '取消收藏' : '添加收藏'}
                aria-pressed={favorited}
                className='flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                onClick={onToggleFavorite}
              >
                <Heart
                  className={`h-4 w-4 ${
                    favorited
                      ? 'fill-red-500 text-red-500'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                />
              </button>
            )}
            {hasEpisodesTab && (
              <button
                type='button'
                className={mobileActionButtonClass}
                onClick={() => setMobileSheet('episodes')}
              >
                <LayoutGrid className='h-3.5 w-3.5' />
                选集
              </button>
            )}
            <button
              type='button'
              className={mobileActionButtonClass}
              onClick={() => setMobileSheet('sources')}
            >
              <ArrowLeftRight className='h-3.5 w-3.5' />
              换源
            </button>
          </div>
        </div>

        {stripEpisodes.length > 0 && (
          <div className='scrollbar-hide -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1'>
            {stripEpisodes.map((episodeNumber) => {
              const active = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  type='button'
                  aria-current={active ? 'true' : undefined}
                  className={`h-11 min-w-[44px] shrink-0 rounded-lg border px-2 text-sm font-medium ${
                    active
                      ? 'border-green-500/60 bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                  }`}
                  onClick={() => onChange?.(episodeNumber)}
                >
                  {episodeNumber}
                </button>
              );
            })}
            <button
              type='button'
              className='h-11 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
              onClick={() => setMobileSheet('episodes')}
            >
              全部
            </button>
          </div>
        )}

        <div className='mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200/60 bg-white/60 dark:border-gray-700/60 dark:bg-gray-800/40'>
          {renderInfoTab('panel')}
        </div>

        <MobileSheet
          open={mobileSheet === 'episodes'}
          title='选集'
          onClose={() => setMobileSheet(null)}
        >
          <div className='flex h-[60dvh] flex-col overflow-hidden'>
            {renderEpisodesTab(() => setMobileSheet(null))}
          </div>
        </MobileSheet>

        <MobileSheet
          open={mobileSheet === 'sources'}
          title='换源'
          onClose={() => setMobileSheet(null)}
        >
          <div className='flex h-[60dvh] flex-col overflow-hidden'>
            {renderSourcesTab(() => setMobileSheet(null))}
          </div>
        </MobileSheet>
      </div>

      <div className='hidden min-h-0 flex-1 flex-col md:flex'>
        <TabBar
          tabs={desktopTabs}
          active={desktopTab}
          onChange={setDesktopTab}
        />

        <PlayerPanelContent>
          {desktopTab === 'main' &&
            (hasEpisodesTab ? (
              <div className='grid min-h-0 min-w-0 flex-1 grid-rows-2 gap-0 overflow-hidden'>
                <div className='flex min-h-0 min-w-0 flex-col overflow-hidden'>
                  {renderInfoTab('desc')}
                </div>
                <div className='flex min-h-0 min-w-0 flex-col overflow-hidden'>
                  <div className='flex-shrink-0 px-5 pt-0 sm:px-6'>
                    <SectionTitle label='选集' />
                  </div>
                  <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
                    {renderEpisodesTab()}
                  </div>
                </div>
              </div>
            ) : (
              renderInfoTab('panel')
            ))}
          {desktopTab === 'sources' && renderSourcesTab()}
        </PlayerPanelContent>
      </div>
    </div>
  );
};

export default EpisodeSelector;

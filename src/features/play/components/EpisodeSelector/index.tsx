import {
  ArrowLeftRight,
  Heart,
  LayoutGrid,
  MessageSquare,
  Star,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import MobileSheet from '@/components/mobile/MobileSheet';
import {
  PLAYER_PANEL_INSET_CLASS,
  PLAYER_PANEL_SURFACE_CLASS,
  PlayerPanelContent,
} from '@/components/PlayerPanelTabBar';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import SkeletonText from '@/components/SkeletonText';
import { EpisodesTab } from '@/features/play/components/EpisodeSelector/EpisodesTab';
import type { InfoRating } from '@/features/play/components/EpisodeSelector/InfoTab';
import {
  DESKTOP_MAIN_GRID_CLASS,
  INFO_COVER_CLASS,
  INFO_RATING_LINE_CLASS,
  INFO_RATING_TEXT_CLASS,
} from '@/features/play/components/EpisodeSelector/layout';
import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';
import { TabBar } from '@/features/play/components/EpisodeSelector/TabBar';
import { useDoubanRating } from '@/features/play/hooks/useDoubanRating';
import type { DanmakuReloadHandler } from '@/features/play/lib/danmaku/types';
import { useVideoReviews } from '@/features/reviews/hooks/useVideoReviews';
import { MOBILE_QUERY } from '@/hooks/useIsMobileViewport';
import {
  collapseSourcesForDisplay,
  getSourceBundle,
} from '@/lib/source-bundle';
import { normalizeWorkTitle } from '@/lib/source-match';
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

function InfoTabLoading({
  scrollMode = 'desc',
}: {
  scrollMode?: 'panel' | 'desc';
}) {
  const desc = scrollMode === 'desc';
  const header = (
    <div
      className={`flex flex-shrink-0 gap-4 ${
        desc ? `${PLAYER_PANEL_INSET_CLASS} pb-3 pt-5` : ''
      }`.trim()}
    >
      <div
        className={`skeleton flex-shrink-0 self-start rounded-lg ${INFO_COVER_CLASS}`}
      />
      <div className='flex min-w-0 flex-1 flex-col justify-between gap-2'>
        <div className='space-y-1.5'>
          <SkeletonText
            className='text-lg leading-snug'
            barClassName='h-4 w-2/3 rounded-md'
          />
          <SkeletonText
            className='text-[13px]'
            barClassName='h-3 w-1/3 rounded'
          />
          <div className='skeleton h-5 w-1/2 rounded' />
          <div className={INFO_RATING_LINE_CLASS}>
            <SkeletonText
              className={INFO_RATING_TEXT_CLASS}
              barClassName='h-3.5 w-24 rounded'
            />
          </div>
        </div>
        <div className='skeleton h-7 w-16 rounded-full' />
      </div>
    </div>
  );
  const lines = (
    <div
      className={`flex min-h-0 flex-col overflow-hidden ${
        desc ? `${PLAYER_PANEL_INSET_CLASS} pb-4` : ''
      }`.trim()}
    >
      {infoSkeletonLineWidths.map((widthClass, index) => (
        <SkeletonText
          key={index}
          className='shrink-0 text-[13px] leading-[1.8]'
          barClassName={`h-3.5 rounded ${widthClass}`}
        />
      ))}
    </div>
  );

  if (desc) {
    return (
      <div data-play-detail-skeleton className='contents'>
        {header}
        {lines}
      </div>
    );
  }

  return (
    <div
      data-play-detail-skeleton
      className={`flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden py-5 ${PLAYER_PANEL_INSET_CLASS}`}
    >
      {header}
      {lines}
    </div>
  );
}

function pickDoubanId(
  candidates: SearchResult[],
  targetTitle: string,
  totalEpisodes: number,
) {
  const normalizedTarget = normalizeWorkTitle(targetTitle);
  if (!normalizedTarget) return 0;

  const counts = new Map<number, number>();
  for (const candidate of candidates) {
    const doubanId = candidate.douban_id || 0;
    if (doubanId <= 0) continue;
    if (normalizeWorkTitle(candidate.title) !== normalizedTarget) {
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

const InfoTab = lazy(() =>
  import('@/features/play/components/EpisodeSelector/InfoTab').then((mod) => ({
    default: mod.InfoTab,
  })),
);
const SourcesTab = dynamic(
  () =>
    import('@/features/play/components/EpisodeSelector/SourcesTab').then(
      (mod) => mod.SourcesTab,
    ),
  { loading: EpisodeTabLoading },
);
const DanmakuTab = dynamic(
  () =>
    import('@/features/play/components/EpisodeSelector/DanmakuTab').then(
      (mod) => mod.DanmakuTab,
    ),
  { loading: EpisodeTabLoading },
);
const ReviewsTab = dynamic(
  () =>
    import('@/features/play/components/EpisodeSelector/ReviewsTab').then(
      (mod) => mod.ReviewsTab,
    ),
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
  detailLoading?: boolean;
  videoYear?: string;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  videoCover?: string;
  videoDoubanId?: number;
  onSourceDetailFetched?: (updated: SearchResult) => void;
  onAddSources?: (newSources: SearchResult[]) => void;
  onDanmakuReload?: DanmakuReloadHandler;
  onDanmakuHeatmapChange?: (enabled: boolean) => void;
}

type MobileSheetKey = 'episodes' | 'sources' | 'danmaku' | 'reviews';
type DesktopTabKey = 'main' | 'sources' | 'danmaku' | 'reviews';

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
  detailLoading = false,
  videoYear = '',
  favorited = false,
  onToggleFavorite,
  videoCover = '',
  videoDoubanId = 0,
  onSourceDetailFetched,
  onAddSources,
  onDanmakuReload,
  onDanmakuHeatmapChange,
}) => {
  const runtimeConfig = useRuntimeConfig();
  const danmakuEnabled = runtimeConfig.ENABLE_DANMAKU;

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

  // 单集且无其他版本时只有一个「正片」按钮，不提供选择意义
  const hasEpisodesTab = totalEpisodes > 1 || variantSources.length > 1;
  const showDesktopEpisodes = detailLoading || hasEpisodesTab;

  // 消息面板的评价详情可带 tab=reviews 进入，直接展示评价。参数打开面板后即从地址移除，
  // 否则换源同步地址时参数串变化会再次抢回评价；播放页之间跳转不会重新挂载，再次带参进入仍能触发
  const searchParams = useSearchParams();
  const reviewsRequest =
    searchParams.get('tab') === 'reviews' ? searchParams.toString() : null;
  const [mobileSheet, setMobileSheet] = useState<MobileSheetKey | null>(null);
  const [desktopTab, setDesktopTab] = useState<DesktopTabKey>(
    reviewsRequest ? 'reviews' : 'main',
  );
  useEffect(() => {
    if (!reviewsRequest) return;
    setDesktopTab('reviews');
    if (window.matchMedia(MOBILE_QUERY).matches) setMobileSheet('reviews');
    const url = new URL(window.location.href);
    url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);
  }, [reviewsRequest]);
  const [reviewEditRequested, setReviewEditRequested] = useState(false);

  const reviews = useVideoReviews({
    title: detail?.title || videoTitle || '',
    year: detail?.year || videoYear,
    cover: videoCover || detail?.poster || '',
    doubanId: resolvedDoubanId,
    sourceKey:
      currentSource && currentId ? `${currentSource}+${currentId}` : '',
    // 详情头部展示站内评分，移动端详情常驻，桌面默认停在详情
    summaryEnabled: true,
  });

  const siteSummary = reviews.summary;
  const siteAverage =
    siteSummary && siteSummary.count > 0 ? siteSummary.average : null;
  // 站内无人评分或汇总失败时以豆瓣评分兜底
  const needsDoubanRating =
    siteAverage === null && (!!siteSummary || reviews.summaryError);
  const doubanRating = useDoubanRating(
    needsDoubanRating ? resolvedDoubanId : 0,
  );
  const infoRating: InfoRating | null =
    siteSummary && siteAverage !== null
      ? { kind: 'site', average: siteAverage, count: siteSummary.count }
      : !needsDoubanRating || doubanRating === undefined
        ? null
        : doubanRating !== null
          ? { kind: 'douban', average: doubanRating }
          : { kind: 'none' };

  const openDesktopReviewEditor = useCallback(() => {
    setDesktopTab('reviews');
    setReviewEditRequested(true);
  }, []);
  const handleReviewEditRequestHandled = useCallback(() => {
    setReviewEditRequested(false);
  }, []);
  const openMobileReviewEditor = useCallback(() => {
    setMobileSheet('reviews');
    setReviewEditRequested(true);
  }, []);

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

  const sourceCount = useMemo(
    () =>
      sourceSearchLoading
        ? 0
        : collapseSourcesForDisplay(availableSources, currentSource, currentId)
            .length,
    [availableSources, currentId, currentSource, sourceSearchLoading],
  );

  const desktopTabs: { key: DesktopTabKey; label: string; count?: number }[] = [
    { key: 'main', label: '详情' },
    { key: 'sources', label: '换源', count: sourceCount },
    ...(danmakuEnabled ? [{ key: 'danmaku', label: '弹幕' } as const] : []),
    { key: 'reviews', label: '评价' },
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

  const renderInfoTab = (
    scrollMode: 'panel' | 'desc',
    onOpenReview: () => void,
  ) => {
    if (detailLoading) {
      return <InfoTabLoading scrollMode={scrollMode} />;
    }

    return (
      <Suspense fallback={<InfoTabLoading scrollMode={scrollMode} />}>
        <InfoTab
          videoTitle={videoTitle || ''}
          detail={detail}
          videoYear={videoYear}
          favorited={favorited}
          onToggleFavorite={onToggleFavorite || (() => {})}
          videoCover={videoCover}
          videoDoubanId={resolvedDoubanId}
          scrollMode={scrollMode}
          myReview={reviews.myReview}
          onOpenReview={onOpenReview}
          rating={infoRating}
        />
      </Suspense>
    );
  };

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

  const renderDanmakuTab = () => (
    <DanmakuTab
      source={currentSource ?? ''}
      videoId={currentId ?? ''}
      episodeIndex={Math.max(0, value - 1)}
      searchTitle={detail?.title || videoTitle || ''}
      onReload={onDanmakuReload}
      onHeatmapChange={onDanmakuHeatmapChange}
    />
  );

  const renderReviewsTab = () => (
    <ReviewsTab
      workTitle={detail?.title || videoTitle || ''}
      reviews={reviews}
      favorited={favorited}
      onAddFavorite={onToggleFavorite}
      editRequested={reviewEditRequested}
      onEditRequestHandled={handleReviewEditRequestHandled}
    />
  );

  const mobileActionButtonClass =
    'flex h-9 items-center gap-1 rounded-full bg-gray-900/[0.05] px-3 text-xs text-gray-700 transition-colors active:bg-gray-900/[0.09] dark:bg-white/[0.06] dark:text-gray-200 dark:active:bg-white/[0.1]';

  return (
    <div className='-mx-4 flex h-full flex-col overflow-hidden px-4 md:mx-0 md:ml-1 md:px-0'>
      <div className='flex min-h-0 flex-1 flex-col md:hidden'>
        <div className='flex items-center justify-between gap-2 py-1'>
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
            {danmakuEnabled && (
              <button
                type='button'
                className={mobileActionButtonClass}
                onClick={() => setMobileSheet('danmaku')}
              >
                <MessageSquare className='h-3.5 w-3.5' />
                弹幕
              </button>
            )}
            <button
              type='button'
              className={mobileActionButtonClass}
              onClick={() => setMobileSheet('reviews')}
            >
              <Star className='h-3.5 w-3.5' />
              评价
            </button>
          </div>
        </div>

        {stripEpisodes.length > 0 && (
          <div className='scrollbar-hide -mx-4 mt-2 flex scroll-px-4 gap-2 overflow-x-auto px-4 pb-1'>
            {stripEpisodes.map((episodeNumber) => {
              const active = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  type='button'
                  aria-current={active ? 'true' : undefined}
                  className={`h-10 min-w-[44px] shrink-0 rounded-lg px-2 text-sm font-medium tabular-nums transition-colors ${
                    active
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-900/[0.05] text-gray-700 dark:bg-white/[0.06] dark:text-gray-200'
                  }`}
                  onClick={() => onChange?.(episodeNumber)}
                >
                  {episodeNumber}
                </button>
              );
            })}
            <button
              type='button'
              className='h-10 shrink-0 rounded-lg bg-gray-900/[0.05] px-3 text-sm text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
              onClick={() => setMobileSheet('episodes')}
            >
              全部
            </button>
          </div>
        )}

        <div
          className={`mt-3 flex min-h-0 flex-1 flex-col ${PLAYER_PANEL_SURFACE_CLASS}`}
        >
          {renderInfoTab('panel', openMobileReviewEditor)}
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

        {danmakuEnabled && (
          <MobileSheet
            open={mobileSheet === 'danmaku'}
            title='弹幕'
            onClose={() => setMobileSheet(null)}
          >
            <div className='flex h-[60dvh] flex-col overflow-hidden'>
              {renderDanmakuTab()}
            </div>
          </MobileSheet>
        )}

        <MobileSheet
          open={mobileSheet === 'reviews'}
          title='评价'
          onClose={() => setMobileSheet(null)}
        >
          <div className='flex h-[70dvh] flex-col overflow-hidden'>
            {renderReviewsTab()}
          </div>
        </MobileSheet>
      </div>

      <div
        className={`hidden min-h-0 flex-1 flex-col md:flex ${PLAYER_PANEL_SURFACE_CLASS}`}
      >
        <TabBar
          tabs={desktopTabs}
          active={desktopTab}
          onChange={setDesktopTab}
        />

        <PlayerPanelContent>
          {desktopTab === 'main' &&
            (showDesktopEpisodes ? (
              <div className={DESKTOP_MAIN_GRID_CLASS}>
                {renderInfoTab('desc', openDesktopReviewEditor)}
                <section
                  aria-label='选集'
                  className='flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-gray-100 pt-3 dark:border-white/[0.06]'
                >
                  <div className={`flex-shrink-0 ${PLAYER_PANEL_INSET_CLASS}`}>
                    <SectionTitle
                      label='选集'
                      count={totalEpisodes > 1 ? totalEpisodes : undefined}
                    />
                  </div>
                  {detailLoading ? (
                    <EpisodesTab
                      loading
                      totalEpisodes={totalEpisodes || 24}
                      episodes_titles={episodes_titles}
                      episodesPerPage={episodesPerPage}
                      value={value}
                      episodeGroups={detail?.episode_groups}
                      variantSources={variantSources}
                      currentSource={currentSource}
                      currentId={currentId}
                    />
                  ) : (
                    renderEpisodesTab()
                  )}
                </section>
              </div>
            ) : (
              renderInfoTab('panel', openDesktopReviewEditor)
            ))}
          {desktopTab === 'sources' && renderSourcesTab()}
          {danmakuEnabled && desktopTab === 'danmaku' && renderDanmakuTab()}
          {desktopTab === 'reviews' && renderReviewsTab()}
        </PlayerPanelContent>
      </div>
    </div>
  );
};

export default EpisodeSelector;

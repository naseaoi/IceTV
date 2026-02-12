import React, { useState } from 'react';

import { SearchResult } from '@/lib/types';

import { EpisodesTab } from './EpisodesTab';
import { InfoTab } from './InfoTab';
import { SourcesTab } from './SourcesTab';

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
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  precomputedVideoInfo?: Map<string, VideoInfo>;
  /** 信息 Tab 所需数据 */
  detail?: SearchResult | null;
  videoYear?: string;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  videoCover?: string;
  videoDoubanId?: number;
}

type TabKey = 'episodes' | 'info' | 'sources';

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
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>(
    totalEpisodes > 1 ? 'episodes' : 'sources',
  );

  const tabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'episodes', label: '选集', show: totalEpisodes > 1 },
    { key: 'info', label: '信息', show: true },
    { key: 'sources', label: '换源', show: true },
  ];

  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className='md:ml-1 h-full rounded-xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-sm flex flex-col ring-1 ring-black/[0.06] dark:ring-white/[0.08] overflow-hidden'>
      {/* Tab 栏 */}
      <div className='flex border-b border-gray-200/80 dark:border-white/10 flex-shrink-0'>
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3 text-center text-sm font-medium transition-all duration-200 relative
              ${
                activeTab === tab.key
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }
            `.trim()}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className='absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-green-500 dark:bg-green-400 rounded-full' />
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'episodes' && totalEpisodes > 1 && (
        <EpisodesTab
          totalEpisodes={totalEpisodes}
          episodes_titles={episodes_titles}
          episodesPerPage={episodesPerPage}
          value={value}
          onChange={onChange}
        />
      )}

      {activeTab === 'info' && (
        <InfoTab
          videoTitle={videoTitle || ''}
          totalEpisodes={totalEpisodes}
          detail={detail}
          videoYear={videoYear}
          favorited={favorited}
          onToggleFavorite={onToggleFavorite || (() => {})}
          videoCover={videoCover}
          videoDoubanId={videoDoubanId}
        />
      )}

      {activeTab === 'sources' && (
        <SourcesTab
          availableSources={availableSources}
          sourceSearchLoading={sourceSearchLoading}
          sourceSearchError={sourceSearchError}
          currentSource={currentSource}
          currentId={currentId}
          videoTitle={videoTitle}
          onSourceChange={onSourceChange}
          precomputedVideoInfo={precomputedVideoInfo}
        />
      )}
    </div>
  );
};

export default EpisodeSelector;

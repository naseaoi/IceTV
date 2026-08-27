import type { ResumeGroupIdentity } from '@/lib/episode-groups';
import type { SearchResult } from '@/lib/types';

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  priority?: boolean;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  resumeTime?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  hasUpdate?: boolean;
  trackingEnabled?: boolean;
  availableEpisodes?: number;
  /** 播放记录的真实集索引（0-based）；分组源展示集数与真实索引不一致时使用 */
  resumeEpisodeIndex?: number;
  /** 分组源的分组身份；上游更新后据此重新对齐集索引 */
  resumeGroup?: ResumeGroupIdentity;
  douban_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
  origin?: 'vod' | 'live';
  aggregateGroup?: SearchResult[];
}

export interface VideoCardDisplayConfig {
  showSourceName: boolean;
  showProgress: boolean;
  showPlayButton: boolean;
  showHeart: boolean;
  showCheckCircle: boolean;
  showDoubanLink: boolean;
  showRating: boolean;
  showYear: boolean;
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
  setDoubanId: (id?: number) => void;
};

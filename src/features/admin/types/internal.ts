export interface SiteConfig {
  SiteName: string;
  SiteIcon: string; // 站点图标 URL（外部链接或 /api/admin/site-icon 本地路径）
  Announcement: string;
  AnnouncementVersion?: string;
  AnnouncementPublishedAt?: number;
  FooterText: string;
  EnableLiveEntry: boolean;
  DefaultAggregateSearch: boolean;
  EnableOptimization: boolean;
  LiveDirectConnect: boolean;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  VodPageTimeoutSeconds: number;
  PlaybackHistoryPageSize: number;
  PlaybackHistoryLimit: number;
  SearchHistoryLimit: number;
  SearchRequestTimeoutSeconds: number;
  SourceFailureCooldownSeconds: number;
  ContinueWatchingLimit: number;
  CoverImageCacheSize: number;
  SourceCoverProxyMode: 'auto' | 'browser' | 'server';
  DataImportPlaybackSessionsLimit: number;
  LivePrecheckTimeoutSeconds: number;
  ProxyRequestTimeoutSeconds: number;
  ImageProxyTimeoutSeconds: number;
  UpstreamSearchConcurrency: number;
  DoubanProxyType: string;
  DoubanProxy: string;
  BangumiDataSource: string;
  BangumiProxy: string;
  DoubanImageProxyType: string;
  DoubanImageProxy: string;
  DisableYellowFilter: boolean;
  FluidSearch: boolean;
}

// 视频源数据类型
export interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  from: 'config' | 'custom';
  proxyMode?: 'server' | 'browser' | 'auto';
}

// 直播源数据类型
export interface LiveDataSource {
  name: string;
  key: string;
  url: string;
  ua?: string;
  epg?: string;
  channelNumber?: number;
  disabled?: boolean;
  from: 'config' | 'custom';
}

// 自定义分类数据类型
export interface CustomCategory {
  name?: string;
  type: 'movie' | 'tv';
  query: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

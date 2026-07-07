export interface AdminConfig {
  ConfigSubscribtion: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  };
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    SiteIcon: string;
    Announcement: string;
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
    DataImportPlaybackSessionsLimit: number;
    LivePrecheckTimeoutSeconds: number;
    ProxyRequestTimeoutSeconds: number;
    DoubanProxyType: string;
    DoubanProxy: string;
    BangumiDataSource: string;
    BangumiProxy: string;
    DoubanImageProxyType: string;
    DoubanImageProxy: string;
    DisableYellowFilter: boolean;
    FluidSearch: boolean;
  };
  UserConfig: {
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      enabledApis?: string[];
      tags?: string[];
    }[];
    OpenRegister?: boolean;
    Tags?: {
      name: string;
      enabledApis: string[];
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
    proxyMode?: 'server' | 'browser' | 'auto';
  }[];
  CustomCategories: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  LiveConfig?: {
    key: string;
    name: string;
    url: string;
    ua?: string;
    epg?: string;
    from: 'config' | 'custom';
    channelNumber?: number;
    disabled?: boolean;
  }[];
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}

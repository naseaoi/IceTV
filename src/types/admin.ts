export interface AdminConfig {
  // 仅后台响应、迁移与备份兼容；运行时配置由 configSelfCheck 剥离。
  ConfigSubscribtion: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  };
  // 订阅原文的真相源是 config_subscription。
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    SiteIcon: string;
    Announcement: string;
    AnnouncementVersion?: string;
    AnnouncementPublishedAt?: number;
    FooterText: string;
    EnableLiveEntry: boolean;
    LiveAccess?: 'all' | 'groups';
    DefaultAggregateSearch: boolean;
    EnableOptimization: boolean;
    LiveDirectConnect: boolean;
    AutoSwitchSource: boolean;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    VodPageTimeoutSeconds: number;
    VodFragmentTimeoutSeconds: number;
    PlaybackHistoryPageSize: number;
    PlaybackHistoryLimit: number;
    SearchHistoryLimit: number;
    SearchRequestTimeoutSeconds: number;
    SourceFailureCooldownSeconds: number;
    ContinueWatchingLimit: number;
    CoverImageCacheSize: number;
    SourceCoverProxyMode?: 'auto' | 'browser' | 'server';
    DataImportPlaybackSessionsLimit: number;
    LivePrecheckTimeoutSeconds: number;
    ProxyRequestTimeoutSeconds: number;
    ImageProxyTimeoutSeconds: number;
    UpstreamSearchConcurrency: number;
    DoubanProxyType: string;
    BangumiDataSource: string;
    DoubanImageProxyType: string;
    DisableYellowFilter: boolean;
    FluidSearch: boolean;
    EnableDanmaku: boolean;
    EnableUserDanmaku: boolean;
    DanmakuEpisodeLimit: number;
    DanmakuRequestTimeoutSeconds: number;
  };
  UserConfig: {
    TotalUsers?: number;
    Users?: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      enabledApis?: string[];
      tags?: string[];
    }[];
    OpenRegister?: boolean;
    RequireInviteCode?: boolean;
    DefaultUserGroup?: string;
    inviteCodeCount?: number;
    activeInviteCodeCount?: number;
    InviteCodes?: {
      code: string;
      createdAt: number;
      expiresAt: number;
      createdBy: string;
      maxUses?: number;
      usedCount?: number;
    }[];
    Tags?: {
      name: string;
      enabledApis: string[];
      allowLive?: boolean;
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
    // 仅站长与管理员可见，普通用户的搜索、详情与播放都不提供该源
    adminOnly?: boolean;
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
    // 仅响应与旧备份兼容，真相源是 live_source_state。
    channelNumber?: number;
    disabled?: boolean;
  }[];
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}

import type { RuntimeParamSettings } from '@/lib/runtime-params';

export type RuntimeParamField = {
  key: keyof RuntimeParamSettings;
  label: string;
  unit: string;
  hint?: string;
};

export type RuntimeParamGroup = {
  id: string;
  title: string;
  fields: RuntimeParamField[];
};

export const COMMON_RUNTIME_PARAM_GROUPS: RuntimeParamGroup[] = [
  {
    id: 'search',
    title: '搜索',
    fields: [
      {
        key: 'SearchDownstreamMaxPage',
        label: '单源搜索最大页数',
        unit: '页',
        hint: '页数越多，搜索覆盖更广，也会增加源站请求。',
      },
      {
        key: 'SearchRequestTimeoutSeconds',
        label: '单次搜索请求超时',
        unit: '秒',
      },
      {
        key: 'UpstreamSearchConcurrency',
        label: '上游搜索并发上限',
        unit: '个',
        hint: '0 表示跟随部署档位或环境变量。',
      },
      {
        key: 'SourceFailureCooldownSeconds',
        label: '搜索源失败冷却',
        unit: '秒',
        hint: '搜索失败后暂时跳过该源；0 表示关闭，不控制播放换源。',
      },
    ],
  },
  {
    id: 'playback',
    title: '播放与记录',
    fields: [
      { key: 'VodPageTimeoutSeconds', label: '点播页等待超时', unit: '秒' },
      {
        key: 'LivePrecheckTimeoutSeconds',
        label: '直播预检查超时',
        unit: '秒',
      },
      { key: 'ContinueWatchingLimit', label: '首页继续观看数量', unit: '条' },
      { key: 'PlaybackHistoryLimit', label: '历史播放条数上限', unit: '条' },
    ],
  },
  {
    id: 'danmaku',
    title: '弹幕',
    fields: [
      {
        key: 'DanmakuEpisodeLimit',
        label: '单集弹幕条数上限',
        unit: '条',
        hint: '超出后按时间抽稀；条数越高，播放器渲染开销越大。',
      },
      {
        key: 'DanmakuRequestTimeoutSeconds',
        label: '弹幕上游请求超时',
        unit: '秒',
        hint: '用于弹幕搜索、绑定校验、内容拉取和连接测试的单次回源请求。',
      },
    ],
  },
  {
    id: 'network',
    title: '缓存与代理',
    fields: [
      {
        key: 'ProxyRequestTimeoutSeconds',
        label: '代理请求超时',
        unit: '秒',
      },
      {
        key: 'ImageProxyTimeoutSeconds',
        label: '图片代理超时',
        unit: '秒',
      },
      {
        key: 'SiteInterfaceCacheTime',
        label: '豆瓣接口响应缓存时间',
        unit: '秒',
        hint: '控制豆瓣接口响应缓存头，不是搜索、封面文件或弹幕缓存时长。',
      },
    ],
  },
];

export const ADVANCED_RUNTIME_PARAM_GROUPS: RuntimeParamGroup[] = [
  {
    id: 'history',
    title: '历史与导入',
    fields: [
      { key: 'SearchHistoryLimit', label: '搜索历史条数上限', unit: '条' },
      { key: 'PlaybackHistoryPageSize', label: '历史播放单页数量', unit: '条' },
      {
        key: 'DataImportPlaybackSessionsLimit',
        label: '导入单用户历史上限',
        unit: '条',
      },
    ],
  },
  {
    id: 'browser-cache',
    title: '浏览器加载记录',
    fields: [
      {
        key: 'CoverImageCacheSize',
        label: '封面加载记录上限',
        unit: '条',
        hint: '原始和代理 URL 分别计数；不限制浏览器图片文件缓存，也不改变服务端图片缓存。',
      },
    ],
  },
];

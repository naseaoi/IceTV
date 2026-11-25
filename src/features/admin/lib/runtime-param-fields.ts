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
        label: '单源最大翻页数',
        unit: '页',
        hint: '页数越多结果越全，源站请求也越多。',
      },
      {
        key: 'SearchRequestTimeoutSeconds',
        label: '单次请求超时',
        unit: '秒',
      },
      {
        key: 'UpstreamSearchConcurrency',
        label: '同时搜索的源数上限',
        unit: '个',
        hint: '0 表示跟随部署档位。',
      },
      {
        key: 'SourceFailureCooldownSeconds',
        label: '出错源跳过时长',
        unit: '秒',
        hint: '0 表示不跳过。',
      },
    ],
  },
  {
    id: 'playback',
    title: '播放',
    fields: [
      {
        key: 'VodPageTimeoutSeconds',
        label: '点播起播超时',
        unit: '秒',
        hint: '起播阶段持续无加载进展时判定失败。',
      },
      {
        key: 'VodFragmentTimeoutSeconds',
        label: '分片请求超时',
        unit: '秒',
        hint: '超时后在直连与代理线路间切换。',
      },
      {
        key: 'LivePrecheckTimeoutSeconds',
        label: '直播格式探测超时',
        unit: '秒',
      },
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
        hint: '超出后按时间均匀抽稀，条数越多播放越吃性能。',
      },
      {
        key: 'DanmakuRequestTimeoutSeconds',
        label: '弹幕上游请求超时',
        unit: '秒',
      },
    ],
  },
  {
    id: 'network',
    title: '代理与缓存',
    fields: [
      {
        key: 'ProxyRequestTimeoutSeconds',
        label: '视频代理超时',
        unit: '秒',
        hint: '播放清单、分片与直播台标。',
      },
      {
        key: 'ImageProxyTimeoutSeconds',
        label: '图片代理超时',
        unit: '秒',
        hint: '海报与番剧封面。',
      },
      {
        key: 'SiteInterfaceCacheTime',
        label: '豆瓣接口浏览器缓存时间',
        unit: '秒',
      },
    ],
  },
];

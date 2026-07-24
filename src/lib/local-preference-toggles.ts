import {
  readAggregateSearch,
  readDefaultAggregateSearch,
  readDefaultEnableOptimization,
  readDefaultFluidSearch,
  readDefaultLiveDirectConnect,
  readEnableOptimization,
  readFluidSearch,
  readLiveDirectConnect,
  resetAggregateSearch,
  resetEnableOptimization,
  resetFluidSearch,
  resetLiveDirectConnect,
  writeAggregateSearch,
  writeEnableOptimization,
  writeFluidSearch,
  writeLiveDirectConnect,
} from '@/lib/local-preferences';

export type LocalPreferenceToggleId =
  | 'defaultAggregateSearch'
  | 'enableOptimization'
  | 'fluidSearch'
  | 'liveDirectConnect';

export type LocalPreferenceToggleSiteConfigKey =
  | 'DefaultAggregateSearch'
  | 'EnableOptimization'
  | 'FluidSearch'
  | 'LiveDirectConnect';

export type LocalPreferenceToggleState = Record<
  LocalPreferenceToggleId,
  boolean
>;

type LocalPreferenceToggleDefinition = {
  id: LocalPreferenceToggleId;
  siteConfigKey: LocalPreferenceToggleSiteConfigKey;
  title: string;
  description: string;
  readValue: () => boolean;
  readDefaultValue: () => boolean;
  writeValue: (value: boolean) => void;
  resetValue: () => void;
};

export const localPreferenceToggleDefinitions: LocalPreferenceToggleDefinition[] =
  [
    {
      id: 'defaultAggregateSearch',
      siteConfigKey: 'DefaultAggregateSearch',
      title: '聚合搜索结果',
      description: '搜索时默认按标题和年份聚合显示结果',
      readValue: readAggregateSearch,
      readDefaultValue: readDefaultAggregateSearch,
      writeValue: writeAggregateSearch,
      resetValue: resetAggregateSearch,
    },
    {
      id: 'enableOptimization',
      siteConfigKey: 'EnableOptimization',
      title: '优选和测速',
      description: '如出现播放器劫持问题可关闭',
      readValue: readEnableOptimization,
      readDefaultValue: readDefaultEnableOptimization,
      writeValue: writeEnableOptimization,
      resetValue: resetEnableOptimization,
    },
    {
      id: 'fluidSearch',
      siteConfigKey: 'FluidSearch',
      title: '流式搜索输出',
      description: '开启时搜索结果将会实时显示',
      readValue: readFluidSearch,
      readDefaultValue: readDefaultFluidSearch,
      writeValue: writeFluidSearch,
      resetValue: resetFluidSearch,
    },
    {
      id: 'liveDirectConnect',
      siteConfigKey: 'LiveDirectConnect',
      title: 'IPTV 视频浏览器直连',
      description: '开启时优先直连，失败会自动回退服务端代理',
      readValue: readLiveDirectConnect,
      readDefaultValue: readDefaultLiveDirectConnect,
      writeValue: writeLiveDirectConnect,
      resetValue: resetLiveDirectConnect,
    },
  ];

export function readLocalPreferenceToggleState(): LocalPreferenceToggleState {
  return localPreferenceToggleDefinitions.reduce((state, definition) => {
    state[definition.id] = definition.readValue();
    return state;
  }, {} as LocalPreferenceToggleState);
}

export function readLocalPreferenceToggleDefaultState(): LocalPreferenceToggleState {
  return localPreferenceToggleDefinitions.reduce((state, definition) => {
    state[definition.id] = definition.readDefaultValue();
    return state;
  }, {} as LocalPreferenceToggleState);
}

export function resetAllLocalPreferenceToggles() {
  localPreferenceToggleDefinitions.forEach((definition) => {
    definition.resetValue();
  });
}

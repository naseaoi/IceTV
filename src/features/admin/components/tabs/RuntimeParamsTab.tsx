'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { RUNTIME_PARAMS_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { adminPost } from '@/features/admin/lib/api';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { useAlertModal } from '@/hooks/useAlertModal';
import {
  applyClientServerConfig,
  fetchClientServerConfig,
} from '@/lib/runtime-config';
import {
  DEFAULT_RUNTIME_PARAMS,
  normalizeRuntimeParams,
  RUNTIME_PARAM_RANGES,
  RuntimeParamSettings,
  runtimeParamsFromConfig,
} from '@/lib/runtime-params';
import { AdminConfig } from '@/types/admin';

type RuntimeParamField = {
  key: keyof RuntimeParamSettings;
  label: string;
  unit: string;
  hint?: string;
};

type RuntimeParamGroup = {
  title: string;
  fields: RuntimeParamField[];
};

const runtimeParamGroups: RuntimeParamGroup[] = [
  {
    title: '搜索',
    fields: [
      {
        key: 'SearchDownstreamMaxPage',
        label: '接口可拉取最大页数',
        unit: '页',
      },
      {
        key: 'SearchRequestTimeoutSeconds',
        label: '接口请求超时',
        unit: '秒',
      },
      {
        key: 'UpstreamSearchConcurrency',
        label: '上游搜索并发上限',
        unit: '个',
        hint: '0 跟随档位',
      },
      { key: 'SearchHistoryLimit', label: '搜索历史条数上限', unit: '条' },
    ],
  },
  {
    title: '播放',
    fields: [
      { key: 'VodPageTimeoutSeconds', label: '点播页超时', unit: '秒' },
      {
        key: 'SourceFailureCooldownSeconds',
        label: '播放源失败冷却',
        unit: '秒',
      },
      {
        key: 'LivePrecheckTimeoutSeconds',
        label: '直播预检查超时',
        unit: '秒',
      },
      { key: 'ContinueWatchingLimit', label: '继续观看首页显示', unit: '条' },
      {
        key: 'DanmakuEpisodeLimit',
        label: '单集弹幕条数上限',
        unit: '条',
        hint: '超出后按时间抽稀',
      },
    ],
  },
  {
    title: '历史与导入',
    fields: [
      { key: 'PlaybackHistoryPageSize', label: '历史播放单页数量', unit: '条' },
      { key: 'PlaybackHistoryLimit', label: '历史播放条数上限', unit: '条' },
      {
        key: 'DataImportPlaybackSessionsLimit',
        label: '导入单用户历史上限',
        unit: '条',
      },
    ],
  },
  {
    title: '缓存与代理',
    fields: [
      {
        key: 'SiteInterfaceCacheTime',
        label: '站点接口缓存时间',
        unit: '秒',
      },
      { key: 'CoverImageCacheSize', label: '图片/封面缓存上限', unit: '张' },
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
    ],
  },
];

function getRuntimeParamInputId(key: keyof RuntimeParamSettings) {
  return `runtime-param-${key}`;
}

const RuntimeParamsTab = ({
  config,
  refreshConfig,
  onSavingChange,
  onDirtyChange,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  onSavingChange?: (saving: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { withLoading } = useLoadingState();
  const [runtimeParams, setRuntimeParams] = useState<RuntimeParamSettings>(
    DEFAULT_RUNTIME_PARAMS,
  );
  const [baselineRuntimeParams, setBaselineRuntimeParams] =
    useState<RuntimeParamSettings>(DEFAULT_RUNTIME_PARAMS);
  const savingRef = useRef(false);
  const normalizedRuntimeParams = normalizeRuntimeParams(runtimeParams);
  const runtimeParamsDirty =
    JSON.stringify(normalizedRuntimeParams) !==
    JSON.stringify(baselineRuntimeParams);

  useEffect(() => {
    if (config?.SiteConfig) {
      const nextRuntimeParams = runtimeParamsFromConfig(config);
      setRuntimeParams(nextRuntimeParams);
      setBaselineRuntimeParams(nextRuntimeParams);
    }
  }, [config]);

  useEffect(() => {
    onDirtyChange?.(runtimeParamsDirty);
  }, [onDirtyChange, runtimeParamsDirty]);

  const handleSave = async () => {
    if (savingRef.current || !runtimeParamsDirty) return;

    savingRef.current = true;
    onSavingChange?.(true);

    try {
      await withLoading('saveRuntimeParams', async () => {
        await adminPost(
          '/api/admin/runtime',
          normalizedRuntimeParams,
          '保存失败',
        );
        try {
          applyClientServerConfig(await fetchClientServerConfig());
        } catch (error) {
          console.warn('刷新客户端运行配置失败:', error);
        }

        setBaselineRuntimeParams(normalizedRuntimeParams);
        showSuccess('保存成功', showAlert);
        await refreshConfig();
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败', showAlert);
    } finally {
      savingRef.current = false;
      onSavingChange?.(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <form id={RUNTIME_PARAMS_FORM_ID} onSubmit={handleSubmit}>
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {runtimeParamGroups.map((group) => (
          <section
            key={group.title}
            className='self-start overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/60'
          >
            <h3 className='border-b border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-900 dark:border-gray-700 dark:text-gray-100'>
              {group.title}
            </h3>
            <div className='divide-y divide-gray-100 dark:divide-gray-700/60'>
              {group.fields.map((field) => {
                const inputId = getRuntimeParamInputId(field.key);
                const range = RUNTIME_PARAM_RANGES[field.key];
                const hintId = `${inputId}-hint`;
                const hintText = field.hint
                  ? `${range.min}-${range.max} · ${field.hint}`
                  : `${range.min}-${range.max}`;

                return (
                  <div
                    key={field.key}
                    className='flex items-center justify-between gap-4 px-4 py-2.5'
                  >
                    <label
                      htmlFor={inputId}
                      className='text-sm font-medium text-gray-700 dark:text-gray-300'
                    >
                      {field.label}
                    </label>
                    <div className='flex shrink-0 items-center gap-2'>
                      <span
                        id={hintId}
                        className='text-xs text-gray-400 dark:text-gray-500'
                      >
                        {hintText}
                      </span>
                      <input
                        id={inputId}
                        name={field.key}
                        type='number'
                        min={range.min}
                        max={range.max}
                        aria-describedby={hintId}
                        value={runtimeParams[field.key]}
                        onChange={(event) =>
                          setRuntimeParams((prev) => ({
                            ...prev,
                            [field.key]: Number(event.target.value),
                          }))
                        }
                        className='w-20 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                      />
                      <span className='w-4 text-xs text-gray-400 dark:text-gray-500'>
                        {field.unit}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </form>
  );
};

export default RuntimeParamsTab;

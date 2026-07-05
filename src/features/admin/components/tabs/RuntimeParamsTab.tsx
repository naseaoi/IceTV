'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { adminPost } from '@/features/admin/lib/api';
import { RUNTIME_PARAMS_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { useAlertModal } from '@/hooks/useAlertModal';
import {
  DEFAULT_RUNTIME_PARAMS,
  RuntimeParamSettings,
  normalizeRuntimeParams,
  runtimeParamsFromConfig,
} from '@/lib/runtime-params';
import { AdminConfig } from '@/types/admin';

type RuntimeParamField = {
  key: keyof RuntimeParamSettings;
  label: string;
  min: number;
  max?: number;
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
        label: '搜索接口可拉取最大页数',
        min: 1,
      },
      {
        key: 'SearchRequestTimeoutSeconds',
        label: '搜索接口请求超时时间（秒）',
        min: 1,
      },
      { key: 'SearchHistoryLimit', label: '搜索历史条数上限', min: 1 },
    ],
  },
  {
    title: '播放',
    fields: [
      { key: 'VodPageTimeoutSeconds', label: '点播页超时时间（秒）', min: 5 },
      {
        key: 'SourceFailureCooldownSeconds',
        label: '播放源失败冷却时间（秒）',
        min: 0,
      },
      { key: 'ContinueWatchingLimit', label: '继续观看首页显示数量', min: 1 },
    ],
  },
  {
    title: '历史与导入',
    fields: [
      { key: 'PlaybackHistoryPageSize', label: '历史播放单页数量', min: 1 },
      { key: 'PlaybackHistoryLimit', label: '历史播放条数上限', min: 1 },
      {
        key: 'DataImportPlaybackSessionsLimit',
        label: '数据导入单用户历史播放上限',
        min: 1,
      },
    ],
  },
  {
    title: '缓存与代理',
    fields: [
      {
        key: 'SiteInterfaceCacheTime',
        label: '站点接口缓存时间（秒）',
        min: 1,
      },
      { key: 'CoverImageCacheSize', label: '图片/封面缓存数量上限', min: 50 },
      {
        key: 'LivePrecheckTimeoutSeconds',
        label: '直播预检查超时时间（秒）',
        min: 1,
      },
      {
        key: 'ProxyRequestTimeoutSeconds',
        label: '代理请求超时时间（秒）',
        min: 1,
      },
    ],
  },
];

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

        setBaselineRuntimeParams(normalizedRuntimeParams);
        showSuccess('保存成功, 请刷新页面', showAlert);
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
    <form
      id={RUNTIME_PARAMS_FORM_ID}
      onSubmit={handleSubmit}
      className='space-y-6'
    >
      {runtimeParamGroups.map((group) => (
        <section
          key={group.title}
          className='space-y-4 rounded-lg border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-900/35'
        >
          <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            {group.title}
          </h3>
          <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3'>
            {group.fields.map((field) => (
              <div key={field.key}>
                <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                  {field.label}
                </label>
                <input
                  type='number'
                  min={field.min}
                  max={field.max}
                  value={runtimeParams[field.key]}
                  onChange={(event) =>
                    setRuntimeParams((prev) => ({
                      ...prev,
                      [field.key]: Number(event.target.value),
                    }))
                  }
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
              </div>
            ))}
          </div>
        </section>
      ))}

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

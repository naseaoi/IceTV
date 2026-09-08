'use client';

import { ChevronDown } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import { RuntimeParamSection } from '@/features/admin/components/tabs/runtime-params/RuntimeParamSection';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { RUNTIME_PARAMS_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { adminPost } from '@/features/admin/lib/api';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import {
  ADVANCED_RUNTIME_PARAM_GROUPS,
  COMMON_RUNTIME_PARAM_GROUPS,
} from '@/features/admin/lib/runtime-param-fields';
import { useAlertModal } from '@/hooks/useAlertModal';
import {
  applyClientServerConfig,
  fetchClientServerConfig,
} from '@/lib/runtime-config';
import {
  DEFAULT_RUNTIME_PARAMS,
  normalizeRuntimeParams,
  RuntimeParamSettings,
  runtimeParamsFromConfig,
} from '@/lib/runtime-params';
import { AdminConfig } from '@/types/admin';

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

  const handleParamChange = (
    key: keyof RuntimeParamSettings,
    value: number,
  ) => {
    setRuntimeParams((previous) => ({ ...previous, [key]: value }));
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
      onInvalidCapture={(event) => {
        if (!(event.target instanceof HTMLInputElement)) return;
        const details = event.target.closest('details');
        if (details) details.open = true;
      }}
    >
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {COMMON_RUNTIME_PARAM_GROUPS.map((group) => (
          <RuntimeParamSection
            key={group.id}
            group={group}
            values={runtimeParams}
            onChange={handleParamChange}
            status={
              group.id === 'danmaku'
                ? config.SiteConfig.EnableDanmaku
                  ? '站点已开启'
                  : '站点未开启'
                : undefined
            }
          />
        ))}
      </div>

      <details className='group mt-4 rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30'>
        <summary className='flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-medium text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-200 [&::-webkit-details-marker]:hidden'>
          <span>高级参数</span>
          <ChevronDown
            aria-hidden
            className='h-4 w-4 shrink-0 transition-transform group-open:rotate-180'
          />
        </summary>
        <div className='grid grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-2'>
          {ADVANCED_RUNTIME_PARAM_GROUPS.map((group) => (
            <RuntimeParamSection
              key={group.id}
              group={group}
              values={runtimeParams}
              onChange={handleParamChange}
            />
          ))}
        </div>
      </details>

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

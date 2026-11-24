'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

import { RuntimeParamSection } from '@/features/admin/components/tabs/runtime-params/RuntimeParamSection';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { RUNTIME_PARAMS_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { adminPost } from '@/features/admin/lib/api';
import { COMMON_RUNTIME_PARAM_GROUPS } from '@/features/admin/lib/runtime-param-fields';
import {
  DEFAULT_RUNTIME_PARAMS,
  normalizeRuntimeParams,
  RuntimeParamSettings,
  runtimeParamsFromConfig,
} from '@/lib/runtime-params';
import { getErrorMessage } from '@/lib/user-facing-error';
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
  const { withLoading } = useLoadingState();
  const [error, setError] = useState('');
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

    setError('');
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
        await refreshConfig();
      });
    } catch (err) {
      setError(getErrorMessage(err, '保存失败'));
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

  if (!config) return null;

  return (
    <form
      id={RUNTIME_PARAMS_FORM_ID}
      onSubmit={handleSubmit}
      className='space-y-8'
    >
      {error && (
        <p role='alert' className='text-sm text-red-600'>
          {error}
        </p>
      )}
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
    </form>
  );
};

export default RuntimeParamsTab;

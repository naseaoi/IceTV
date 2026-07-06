'use client';

import { AlertTriangle, Loader2, RotateCcw, Save } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import ConfirmModal from '@/components/modals/ConfirmModal';
import AdminNav from '@/features/admin/components/AdminNav';
import AdminTabContent from '@/features/admin/components/AdminTabContent';
import AlertModal from '@/components/modals/AlertModal';
import {
  RUNTIME_PARAMS_FORM_ID,
  SITE_CONFIG_FORM_ID,
} from '@/features/admin/lib/admin-form-ids';
import { getVisibleTabs } from '@/features/admin/lib/admin-tabs';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { isOwner } from '@/features/admin/lib/permissions';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useAdminPageActions } from '@/features/admin/hooks/useAdminPageActions';
import { useAdminTab } from '@/features/admin/hooks/useAdminTab';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { AdminConfig } from '@/types/admin';

const headerActionButtonClassName =
  'mb-2 flex h-9 w-10 shrink-0 items-center justify-center rounded-lg text-white transition-colors';

function getAdminErrorView(error: string) {
  const normalizedError = error.toLowerCase();
  const isUnauthorized =
    normalizedError.includes('unauthorized') ||
    normalizedError.includes('401') ||
    error.includes('未登录');
  const isForbidden =
    normalizedError.includes('forbidden') ||
    normalizedError.includes('403') ||
    error.includes('权限') ||
    error.includes('管理员');

  if (isUnauthorized) {
    return {
      title: '需要登录',
      message: '请先登录管理员账号后再进入后台。',
      actionHref: '/login?redirect=%2Fadmin',
      actionText: '前往登录',
    };
  }

  if (isForbidden) {
    return {
      title: '无后台权限',
      message: '当前账号没有后台访问权限。',
      actionHref: '/',
      actionText: '返回首页',
    };
  }

  return {
    title: '后台加载失败',
    message: error || '后台配置读取失败。',
    actionHref: '/',
    actionText: '返回首页',
  };
}

function AdminPageClient() {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [showResetConfigModal, setShowResetConfigModal] = useState(false);
  const [siteConfigSaving, setSiteConfigSaving] = useState(false);
  const [runtimeParamsSaving, setRuntimeParamsSaving] = useState(false);
  const [siteConfigDirty, setSiteConfigDirty] = useState(false);
  const [runtimeParamsDirty, setRuntimeParamsDirty] = useState(false);

  const isOwnerRole = isOwner(role);
  const visibleTabs = getVisibleTabs(isOwnerRole);
  const { activeTab, setActiveTab } = useAdminTab(isOwnerRole);
  const activeSaveAction =
    activeTab === 'site'
      ? {
          formId: SITE_CONFIG_FORM_ID,
          saving: siteConfigSaving,
          dirty: siteConfigDirty,
          title: '保存站点配置',
        }
      : activeTab === 'runtime'
        ? {
            formId: RUNTIME_PARAMS_FORM_ID,
            saving: runtimeParamsSaving,
            dirty: runtimeParamsDirty,
            title: '保存运行参数',
          }
        : null;

  const { fetchConfig, resetConfig } = useAdminPageActions({
    showAlert,
    setConfig,
    setRole,
    setError,
    setLoading,
  });

  useEffect(() => {
    fetchConfig(true);
  }, [fetchConfig]);

  const handleResetConfig = () => {
    setShowResetConfigModal(true);
  };

  const handleConfirmResetConfig = async () => {
    await withLoading('resetConfig', async () => {
      try {
        await resetConfig();
        await fetchConfig();
        setShowResetConfigModal(false);
      } catch (err) {
        showError(err instanceof Error ? err.message : '重置失败', showAlert);
        throw err;
      }
    });
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 py-4 sm:px-10 sm:py-8 md:-mb-14 md:flex md:h-dvh md:min-h-0 md:flex-col'>
          <div className='mx-auto w-full max-w-[95%] md:flex md:min-h-0 md:flex-1 md:flex-col'>
            <div className='flex h-[52px] shrink-0 items-end gap-1.5 pr-1'>
              <div className='h-11 w-28 animate-pulse rounded-t-lg bg-gray-200 dark:bg-gray-700' />
              <div className='h-9 w-24 animate-pulse rounded-t-lg bg-gray-100 dark:bg-gray-800' />
              <div className='h-9 w-24 animate-pulse rounded-t-lg bg-gray-100 dark:bg-gray-800' />
              <div className='h-9 w-28 animate-pulse rounded-t-lg bg-gray-100 dark:bg-gray-800' />
            </div>

            <section className='flex min-w-0 items-center justify-center rounded-xl rounded-tl-none border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/50 sm:p-6 md:min-h-0 md:flex-1'>
              <div className='flex flex-col items-center gap-4 text-center'>
                <Loader2 className='h-10 w-10 animate-spin text-green-500' />
                <div>
                  <p className='text-base font-medium text-gray-900 dark:text-gray-100'>
                    正在加载后台配置
                  </p>
                  <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                    请稍候片刻...
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    const errorView = getAdminErrorView(error);

    return (
      <PageLayout activePath='/admin'>
        <div className='flex min-h-[60vh] items-center justify-center px-4 py-12'>
          <section className='w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800'>
            <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'>
              <AlertTriangle className='h-6 w-6' aria-hidden='true' />
            </div>
            <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              {errorView.title}
            </h1>
            <p className='mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300'>
              {errorView.message}
            </p>
            <a
              href={errorView.actionHref}
              className='mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-green-600 px-4 text-sm font-medium text-white transition-colors hover:bg-green-700'
            >
              {errorView.actionText}
            </a>
          </section>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 py-4 sm:px-10 sm:py-8 md:-mb-14 md:flex md:h-dvh md:min-h-0 md:flex-col'>
        <div className='mx-auto w-full max-w-[95%] md:flex md:min-h-0 md:flex-1 md:flex-col'>
          <div className='flex shrink-0 items-end gap-3'>
            <div className='min-w-0 flex-1'>
              <AdminNav
                tabs={visibleTabs}
                activeTab={activeTab}
                onSelect={setActiveTab}
              />
            </div>
            {config && activeSaveAction && (
              <button
                type='submit'
                form={activeSaveAction.formId}
                disabled={activeSaveAction.saving || !activeSaveAction.dirty}
                title={
                  activeSaveAction.saving
                    ? '保存中...'
                    : activeSaveAction.dirty
                      ? activeSaveAction.title
                      : '没有改动'
                }
                aria-label={
                  activeSaveAction.saving
                    ? '保存中'
                    : activeSaveAction.dirty
                      ? activeSaveAction.title
                      : '没有改动'
                }
                className={`${headerActionButtonClassName} ${
                  activeSaveAction.saving
                    ? 'cursor-not-allowed bg-gray-400 dark:bg-gray-600'
                    : activeSaveAction.dirty
                      ? 'bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700'
                      : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}
              >
                {activeSaveAction.saving ? (
                  <Loader2 size={18} className='animate-spin' />
                ) : (
                  <Save size={18} />
                )}
              </button>
            )}
            {config && isOwnerRole && (
              <button
                type='button'
                onClick={handleResetConfig}
                title='重置配置'
                aria-label='重置配置'
                className={`${headerActionButtonClassName} bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700`}
              >
                <RotateCcw size={18} />
              </button>
            )}
          </div>

          <section className='min-w-0 overflow-auto rounded-xl rounded-tl-none border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/50 sm:p-6 md:min-h-0 md:flex-1'>
            <AdminTabContent
              activeTab={activeTab}
              config={config}
              role={role}
              refreshConfig={fetchConfig}
              onSiteConfigSavingChange={setSiteConfigSaving}
              onRuntimeParamsSavingChange={setRuntimeParamsSaving}
              onSiteConfigDirtyChange={setSiteConfigDirty}
              onRuntimeParamsDirtyChange={setRuntimeParamsDirty}
            />
          </section>
        </div>
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

      <ConfirmModal
        isOpen={showResetConfigModal}
        title='确认重置配置'
        onClose={() => setShowResetConfigModal(false)}
        onConfirm={handleConfirmResetConfig}
        confirmDisabled={isLoading('resetConfig')}
        confirmText={isLoading('resetConfig') ? '重置中...' : '确认重置'}
        confirmClassName={`px-6 py-2.5 text-sm font-medium ${
          isLoading('resetConfig') ? buttonStyles.disabled : buttonStyles.danger
        }`}
        cancelClassName={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
      >
        <div className='mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20'>
          <div className='mb-2 flex items-center space-x-2'>
            <svg
              className='h-5 w-5 text-yellow-600 dark:text-yellow-400'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              />
            </svg>
            <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
              危险操作警告
            </span>
          </div>
          <p className='text-sm text-yellow-700 dark:text-yellow-400'>
            此操作将重置用户封禁和管理员设置、自定义视频源，站点配置将重置为默认值，是否继续？
          </p>
        </div>
      </ConfirmModal>
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}

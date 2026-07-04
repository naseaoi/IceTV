'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import ConfirmModal from '@/components/modals/ConfirmModal';
import AdminNav from '@/features/admin/components/AdminNav';
import AdminTabContent from '@/features/admin/components/AdminTabContent';
import AlertModal from '@/components/modals/AlertModal';
import { getVisibleTabs } from '@/features/admin/lib/admin-tabs';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { isOwner } from '@/features/admin/lib/permissions';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useAdminPageActions } from '@/features/admin/hooks/useAdminPageActions';
import { useAdminTab } from '@/features/admin/hooks/useAdminTab';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { AdminConfig } from '@/types/admin';

function AdminPageClient() {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [showResetConfigModal, setShowResetConfigModal] = useState(false);

  const isOwnerRole = isOwner(role);
  const visibleTabs = getVisibleTabs(isOwnerRole);
  const { activeTab, setActiveTab } = useAdminTab(isOwnerRole);

  const { fetchConfig, resetConfig } = useAdminPageActions({
    showAlert,
    setConfig,
    setRole,
    setError,
    setLoading,
  });

  useEffect(() => {
    // 首次加载时显示骨架
    fetchConfig(true);
  }, [fetchConfig]);

  // 新增: 重置配置处理函数
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
            {/* Tab 占位行 */}
            <div className='flex h-[52px] shrink-0 items-end gap-1.5 pr-1'>
              <div className='h-11 w-28 animate-pulse rounded-t-lg bg-gray-200 dark:bg-gray-700' />
              <div className='h-9 w-24 animate-pulse rounded-t-lg bg-gray-100 dark:bg-gray-800' />
              <div className='h-9 w-24 animate-pulse rounded-t-lg bg-gray-100 dark:bg-gray-800' />
              <div className='h-9 w-28 animate-pulse rounded-t-lg bg-gray-100 dark:bg-gray-800' />
            </div>

            {/* 内容卡占位 */}
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
    // 错误已通过弹窗展示，此处直接返回空
    return null;
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 py-4 sm:px-10 sm:py-8 md:-mb-14 md:flex md:h-dvh md:min-h-0 md:flex-col'>
        <div className='mx-auto w-full max-w-[95%] md:flex md:min-h-0 md:flex-1 md:flex-col'>
          {/* 顶部 header: Tab 导航 + 重置配置 */}
          <div className='flex shrink-0 items-end gap-3'>
            <div className='min-w-0 flex-1'>
              <AdminNav
                tabs={visibleTabs}
                activeTab={activeTab}
                onSelect={setActiveTab}
              />
            </div>
            {config && isOwnerRole && (
              <button
                onClick={handleResetConfig}
                title='重置配置'
                aria-label='重置配置'
                className='mb-2 flex shrink-0 items-center justify-center rounded-full p-2 text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30'
              >
                <RotateCcw size={18} />
              </button>
            )}
          </div>

          {/* 内容区 */}
          <section className='min-w-0 overflow-auto rounded-xl rounded-tl-none border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/50 sm:p-6 md:min-h-0 md:flex-1'>
            <AdminTabContent
              activeTab={activeTab}
              config={config}
              role={role}
              refreshConfig={fetchConfig}
            />
          </section>
        </div>
      </div>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />

      {/* 重置配置确认弹窗 */}
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
              ⚠️ 危险操作警告
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

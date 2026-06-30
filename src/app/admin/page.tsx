'use client';

import { Loader2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import ConfirmModal from '@/components/modals/ConfirmModal';
import AdminNav from '@/features/admin/components/AdminNav';
import AdminTabContent from '@/features/admin/components/AdminTabContent';
import AlertModal from '@/features/admin/components/AlertModal';
import { getVisibleTabs } from '@/features/admin/lib/admin-tabs';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { isOwner } from '@/features/admin/lib/permissions';
import { useAlertModal } from '@/features/admin/hooks/useAlertModal';
import { useAdminPageActions } from '@/features/admin/hooks/useAdminPageActions';
import { useAdminTab } from '@/features/admin/hooks/useAdminTab';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { AdminConfig } from '@/features/admin/types/api';

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
        <div className='px-2 py-4 sm:px-10 sm:py-8'>
          <div className='mx-auto max-w-[95%]'>
            <h1 className='mb-8 text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理员设置
            </h1>
            <div className='flex min-h-[320px] items-center justify-center rounded-xl border border-gray-200 bg-white/80 backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/50'>
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
            </div>
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
      <div className='px-2 py-4 sm:px-10 sm:py-8'>
        <div className='mx-auto max-w-[95%]'>
          {/* 标题 + 重置配置按钮 */}
          <div className='mb-8 flex items-center gap-2'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理员设置
            </h1>
            {config && isOwnerRole && (
              <button
                onClick={handleResetConfig}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${buttonStyles.dangerSmall}`}
              >
                重置配置
              </button>
            )}
          </div>

          {/* 侧边导航 + 内容区 */}
          <div className='gap-6 md:grid md:grid-cols-[200px_1fr]'>
            <aside className='mb-4 md:mb-0'>
              <div className='rounded-xl bg-white/80 p-2 shadow-sm backdrop-blur-md dark:bg-gray-800/50 dark:ring-1 dark:ring-gray-700 md:sticky md:top-4'>
                <AdminNav
                  tabs={visibleTabs}
                  activeTab={activeTab}
                  onSelect={setActiveTab}
                />
              </div>
            </aside>

            <section className='min-w-0 rounded-xl bg-white/80 p-4 shadow-sm backdrop-blur-md dark:bg-gray-800/50 dark:ring-1 dark:ring-gray-700 sm:p-6'>
              <AdminTabContent
                activeTab={activeTab}
                config={config}
                role={role}
                refreshConfig={fetchConfig}
              />
            </section>
          </div>
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

'use client';

'use client';

import {
  Database,
  FileText,
  FolderOpen,
  Settings,
  Tv,
  Users,
  Video,
} from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import DataMigration from '@/components/DataMigration';
import PageLayout from '@/components/PageLayout';
import AlertModal from '@/features/admin/components/AlertModal';
import CollapsibleTab from '@/features/admin/components/CollapsibleTab';
import ConfirmModal from '@/features/admin/components/ConfirmModal';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { isOwner } from '@/features/admin/lib/permissions';
import CategoryConfig from '@/features/admin/components/tabs/CategoryConfigTab';
import ConfigFileComponent from '@/features/admin/components/tabs/ConfigFileTab';
import LiveSourceConfig from '@/features/admin/components/tabs/LiveSourceConfigTab';
import SiteConfigComponent from '@/features/admin/components/tabs/SiteConfigTab';
import UserConfig from '@/features/admin/components/tabs/UserConfigTab';
import VideoSourceConfig from '@/features/admin/components/tabs/VideoSourceConfigTab';
import { useAlertModal } from '@/features/admin/hooks/useAlertModal';
import { useAdminPageActions } from '@/features/admin/hooks/useAdminPageActions';
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
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    videoSource: false,
    liveSource: false,
    siteConfig: false,
    categoryConfig: false,
    configFile: false,
    dataMigration: false,
  });

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

  // 切换标签展开状态
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

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
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>
              管理员设置
            </h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                />
              ))}
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
      <div className='px-2 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-[95%] mx-auto'>
          {/* 标题 + 重置配置按钮 */}
          <div className='flex items-center gap-2 mb-8'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理员设置
            </h1>
            {config && isOwner(role) && (
              <button
                onClick={handleResetConfig}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${buttonStyles.dangerSmall}`}
              >
                重置配置
              </button>
            )}
          </div>

          {/* 配置文件标签 - 仅站长可见 */}
          {isOwner(role) && (
            <CollapsibleTab
              title='配置文件'
              icon={
                <FileText
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.configFile}
              onToggle={() => toggleTab('configFile')}
            >
              <ConfigFileComponent
                config={config}
                refreshConfig={fetchConfig}
              />
            </CollapsibleTab>
          )}

          {/* 站点配置标签 */}
          <CollapsibleTab
            title='站点配置'
            icon={
              <Settings
                size={20}
                className='text-gray-600 dark:text-gray-400'
              />
            }
            isExpanded={expandedTabs.siteConfig}
            onToggle={() => toggleTab('siteConfig')}
          >
            <SiteConfigComponent config={config} refreshConfig={fetchConfig} />
          </CollapsibleTab>

          <div className='space-y-4'>
            {/* 用户配置标签 */}
            <CollapsibleTab
              title='用户配置'
              icon={
                <Users size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.userConfig}
              onToggle={() => toggleTab('userConfig')}
            >
              <UserConfig
                config={config}
                role={role}
                refreshConfig={fetchConfig}
              />
            </CollapsibleTab>

            {/* 视频源配置标签 */}
            <CollapsibleTab
              title='视频源配置'
              icon={
                <Video size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.videoSource}
              onToggle={() => toggleTab('videoSource')}
            >
              <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 直播源配置标签 */}
            <CollapsibleTab
              title='直播源配置'
              icon={
                <Tv size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.liveSource}
              onToggle={() => toggleTab('liveSource')}
            >
              <LiveSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 分类配置标签 */}
            <CollapsibleTab
              title='分类配置'
              icon={
                <FolderOpen
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.categoryConfig}
              onToggle={() => toggleTab('categoryConfig')}
            >
              <CategoryConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 数据迁移标签 - 仅站长可见 */}
            {isOwner(role) && (
              <CollapsibleTab
                title='数据迁移'
                icon={
                  <Database
                    size={20}
                    className='text-gray-600 dark:text-gray-400'
                  />
                }
                isExpanded={expandedTabs.dataMigration}
                onToggle={() => toggleTab('dataMigration')}
              >
                <DataMigration onRefreshConfig={fetchConfig} />
              </CollapsibleTab>
            )}
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
        <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4'>
          <div className='flex items-center space-x-2 mb-2'>
            <svg
              className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
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

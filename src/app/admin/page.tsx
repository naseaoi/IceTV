'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import AdminNav from '@/features/admin/components/AdminNav';
import AdminSaveBar from '@/features/admin/components/AdminSaveBar';
import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import AdminTabContent from '@/features/admin/components/AdminTabContent';
import { useAdminPageActions } from '@/features/admin/hooks/useAdminPageActions';
import { useAdminTab } from '@/features/admin/hooks/useAdminTab';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import {
  CONFIG_FILE_FORM_ID,
  RUNTIME_PARAMS_FORM_ID,
  SITE_CONFIG_FORM_ID,
} from '@/features/admin/lib/admin-form-ids';
import {
  type AdminTabId,
  getVisibleTabs,
} from '@/features/admin/lib/admin-tabs';
import { showError } from '@/features/admin/lib/notifications';
import { isOwner } from '@/features/admin/lib/permissions';
import { useAlertModal } from '@/hooks/useAlertModal';
import { scrollPageTo } from '@/hooks/usePageScroll';
import { AdminConfig } from '@/types/admin';

const ADMIN_MOBILE_HEADER = { title: '管理后台' };
function AdminShell({
  nav,
  children,
}: {
  nav: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PageLayout activePath='/admin' mobileHeader={ADMIN_MOBILE_HEADER}>
      <div
        className={`${PAGE_CONTAINER_CLASS} flex flex-col gap-4 py-4 sm:py-6 md:flex-row md:gap-8 md:py-8`}
      >
        {nav}
        <div className='min-w-0 flex-1'>{children}</div>
      </div>
    </PageLayout>
  );
}

function AdminLoadingSkeleton() {
  return (
    <AdminShell
      nav={
        <div className='flex gap-2 md:w-52 md:shrink-0 md:flex-col md:gap-1.5 lg:w-56'>
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className='skeleton h-8 w-20 rounded-full md:h-9 md:w-full md:rounded-lg'
            />
          ))}
        </div>
      }
    >
      <div className='space-y-4'>
        <div className='skeleton h-10 w-full rounded-lg' />
        <div className='skeleton h-10 w-2/3 rounded-lg' />
        <div className='skeleton h-24 w-full rounded-lg' />
      </div>
    </AdminShell>
  );
}

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
  const [configFileSaving, setConfigFileSaving] = useState(false);
  const [siteConfigDirty, setSiteConfigDirty] = useState(false);
  const [runtimeParamsDirty, setRuntimeParamsDirty] = useState(false);
  const [configFileDirty, setConfigFileDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<AdminTabId | null>(null);
  // 放弃改动时递增，让表单按当前配置重新挂载
  const [formRevision, setFormRevision] = useState(0);

  const isOwnerRole = isOwner(role);
  const visibleTabs = getVisibleTabs(isOwnerRole);
  const { activeTab, setActiveTab } = useAdminTab(isOwnerRole);
  const activeSaveAction =
    activeTab === 'config-file'
      ? {
          formId: CONFIG_FILE_FORM_ID,
          saving: configFileSaving,
          dirty: configFileDirty,
        }
      : activeTab === 'site'
        ? {
            formId: SITE_CONFIG_FORM_ID,
            saving: siteConfigSaving,
            dirty: siteConfigDirty,
          }
        : activeTab === 'runtime'
          ? {
              formId: RUNTIME_PARAMS_FORM_ID,
              saving: runtimeParamsSaving,
              dirty: runtimeParamsDirty,
            }
          : null;
  const activeFormDirty = Boolean(activeSaveAction?.dirty);
  const activeFormId = activeSaveAction?.formId;
  const hasUnsavedChanges =
    configFileDirty || siteConfigDirty || runtimeParamsDirty;
  const navCounts = config
    ? {
        'video-source': config.SourceConfig.length,
        'live-source': config.LiveConfig?.length ?? 0,
        category: config.CustomCategories.length,
        user: config.UserConfig.Users.length,
      }
    : undefined;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        !hasUnsavedChanges ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) {
        return;
      }
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname
      ) {
        return;
      }
      if (!window.confirm('当前页面有未保存的改动，确定要离开吗？')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [hasUnsavedChanges]);

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

  useEffect(() => {
    if (!activeFormId || !activeFormDirty) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 's' ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      const form = document.getElementById(activeFormId);
      if (form instanceof HTMLFormElement) form.requestSubmit();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFormDirty, activeFormId]);

  const clearActiveFormDirty = () => {
    if (activeTab === 'config-file') setConfigFileDirty(false);
    if (activeTab === 'site') setSiteConfigDirty(false);
    if (activeTab === 'runtime') setRuntimeParamsDirty(false);
  };

  const switchTab = (tab: AdminTabId) => {
    setActiveTab(tab);
    scrollPageTo(0);
  };

  const handleSelectTab = (tab: AdminTabId) => {
    if (tab === activeTab) return;
    if (activeFormDirty) {
      setPendingTab(tab);
      return;
    }
    switchTab(tab);
  };

  const handleDiscardAndSwitchTab = () => {
    if (!pendingTab) return;
    clearActiveFormDirty();
    const nextTab = pendingTab;
    setPendingTab(null);
    switchTab(nextTab);
  };

  const handleDiscardChanges = () => {
    clearActiveFormDirty();
    setFormRevision((revision) => revision + 1);
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

  if (loading) return <AdminLoadingSkeleton />;

  if (error) {
    const errorView = getAdminErrorView(error);

    return (
      <PageLayout activePath='/admin' mobileHeader={ADMIN_MOBILE_HEADER}>
        <div className='flex min-h-[60vh] items-center justify-center py-12'>
          <LoadingStatePanel
            icon={<AlertTriangle className='h-7 w-7' aria-hidden='true' />}
            tone='amber'
            title={errorView.title}
            message={errorView.message}
          >
            <a
              href={errorView.actionHref}
              className='mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700'
            >
              {errorView.actionText}
            </a>
          </LoadingStatePanel>
        </div>
      </PageLayout>
    );
  }

  return (
    <AdminShell
      nav={
        <AdminNav
          tabs={visibleTabs}
          activeTab={activeTab}
          onSelect={handleSelectTab}
          counts={navCounts}
          dirtyTab={activeFormDirty ? activeTab : null}
        />
      }
    >
      <AdminTabContent
        key={`${activeTab}:${formRevision}`}
        activeTab={activeTab}
        config={config}
        role={role}
        refreshConfig={fetchConfig}
        onSiteConfigSavingChange={setSiteConfigSaving}
        onRuntimeParamsSavingChange={setRuntimeParamsSaving}
        onConfigFileSavingChange={setConfigFileSaving}
        onSiteConfigDirtyChange={setSiteConfigDirty}
        onRuntimeParamsDirtyChange={setRuntimeParamsDirty}
        onConfigFileDirtyChange={setConfigFileDirty}
      />

      {config && isOwnerRole && activeTab === 'config-file' && (
        <AdminSettingsGroup title='危险操作' className='mt-8'>
          <AdminSettingRow label='重置配置' layout='inline'>
            <button
              type='button'
              onClick={() => setShowResetConfigModal(true)}
              aria-label='重置配置'
              className='flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-200 transition-colors hover:bg-red-50 dark:text-red-400 dark:ring-red-500/30 dark:hover:bg-red-500/10'
            >
              <RotateCcw aria-hidden='true' className='h-4 w-4' />
              重置
            </button>
          </AdminSettingRow>
        </AdminSettingsGroup>
      )}

      {config && activeSaveAction?.dirty && (
        <AdminSaveBar
          formId={activeSaveAction.formId}
          saving={activeSaveAction.saving}
          onDiscard={handleDiscardChanges}
        />
      )}

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
        isOpen={pendingTab !== null}
        title='放弃未保存的改动？'
        message='当前页面的改动尚未保存，切换后将无法恢复。'
        onClose={() => setPendingTab(null)}
        onConfirm={handleDiscardAndSwitchTab}
        confirmText='放弃并切换'
        cancelText='继续编辑'
        danger
      />

      <ConfirmModal
        isOpen={showResetConfigModal}
        title='确认重置配置'
        message='用户封禁与管理员设置、自定义视频源将被清除，站点配置恢复默认值。'
        onClose={() => setShowResetConfigModal(false)}
        onConfirm={handleConfirmResetConfig}
        confirmDisabled={isLoading('resetConfig')}
        confirmText={isLoading('resetConfig') ? '重置中...' : '确认重置'}
        danger
      />
    </AdminShell>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AuthenticatedRoute
        activePath='/admin'
        message='请先登录管理员账号后再进入后台。'
      >
        <AdminPageClient />
      </AuthenticatedRoute>
    </Suspense>
  );
}

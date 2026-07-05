'use client';

import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';

import { type AdminTabId } from '@/features/admin/lib/admin-tabs';
import { type AdminConfig } from '@/types/admin';

function AdminTabLoading() {
  return (
    <div className='flex min-h-32 items-center justify-center text-sm text-gray-500 dark:text-gray-400'>
      <Loader2 className='mr-2 h-4 w-4 animate-spin text-green-500' />
      加载中...
    </div>
  );
}

const DataMigration = dynamic(
  () =>
    import('../../../components/DataMigration.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);
const CategoryConfig = dynamic(
  () => import('./tabs/CategoryConfigTab.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);
const ConfigFileComponent = dynamic(
  () => import('./tabs/ConfigFileTab.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);
const LiveSourceConfig = dynamic(
  () => import('./tabs/LiveSourceConfigTab.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);
const SiteConfigComponent = dynamic(
  () => import('./tabs/SiteConfigTab.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);
const RuntimeParamsComponent = dynamic(
  () => import('./tabs/RuntimeParamsTab.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);
const UserConfig = dynamic(
  () => import('./tabs/UserConfigTab.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);
const VideoSourceConfig = dynamic(
  () => import('./tabs/VideoSourceConfigTab.js').then((mod) => mod.default),
  { loading: AdminTabLoading },
);

interface AdminTabContentProps {
  activeTab: AdminTabId;
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
  onSiteConfigSavingChange?: (saving: boolean) => void;
  onRuntimeParamsSavingChange?: (saving: boolean) => void;
  onSiteConfigDirtyChange?: (dirty: boolean) => void;
  onRuntimeParamsDirtyChange?: (dirty: boolean) => void;
}

const AdminTabContent = ({
  activeTab,
  config,
  role,
  refreshConfig,
  onSiteConfigSavingChange,
  onRuntimeParamsSavingChange,
  onSiteConfigDirtyChange,
  onRuntimeParamsDirtyChange,
}: AdminTabContentProps) => {
  switch (activeTab) {
    case 'config-file':
      return (
        <ConfigFileComponent config={config} refreshConfig={refreshConfig} />
      );
    case 'runtime':
      return (
        <RuntimeParamsComponent
          config={config}
          refreshConfig={refreshConfig}
          onSavingChange={onRuntimeParamsSavingChange}
          onDirtyChange={onRuntimeParamsDirtyChange}
        />
      );
    case 'site':
      return (
        <SiteConfigComponent
          config={config}
          refreshConfig={refreshConfig}
          onSavingChange={onSiteConfigSavingChange}
          onDirtyChange={onSiteConfigDirtyChange}
        />
      );
    case 'user':
      return (
        <UserConfig config={config} role={role} refreshConfig={refreshConfig} />
      );
    case 'video-source':
      return (
        <VideoSourceConfig config={config} refreshConfig={refreshConfig} />
      );
    case 'live-source':
      return <LiveSourceConfig config={config} refreshConfig={refreshConfig} />;
    case 'category':
      return <CategoryConfig config={config} refreshConfig={refreshConfig} />;
    case 'data-migration':
      return <DataMigration onRefreshConfig={refreshConfig} />;
    default:
      return null;
  }
};

export default AdminTabContent;

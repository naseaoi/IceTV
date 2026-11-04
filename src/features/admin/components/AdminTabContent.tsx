'use client';

import dynamic from 'next/dynamic';

import AdminContentSkeleton, {
  AdminSkeletonContext,
} from '@/features/admin/components/AdminContentSkeleton';
import { type AdminTabId } from '@/features/admin/lib/admin-tabs';
import { type AdminConfig } from '@/types/admin';

const DataMigration = dynamic(
  () => import('@/components/DataMigration').then((mod) => mod.default),
  { loading: () => <AdminContentSkeleton /> },
);
const CategoryConfig = dynamic(
  () =>
    import('@/features/admin/components/tabs/CategoryConfigTab').then(
      (mod) => mod.default,
    ),
  { loading: () => <AdminContentSkeleton /> },
);
const ConfigFileComponent = dynamic(
  () =>
    import('@/features/admin/components/tabs/ConfigFileTab').then(
      (mod) => mod.default,
    ),
  { loading: () => <AdminContentSkeleton /> },
);
const LiveSourceConfig = dynamic(
  () =>
    import('@/features/admin/components/tabs/LiveSourceConfigTab').then(
      (mod) => mod.default,
    ),
  { loading: () => <AdminContentSkeleton /> },
);
const SiteConfigComponent = dynamic(
  () =>
    import('@/features/admin/components/tabs/SiteConfigTab').then(
      (mod) => mod.default,
    ),
  { loading: () => <AdminContentSkeleton /> },
);
const RuntimeParamsComponent = dynamic(
  () =>
    import('@/features/admin/components/tabs/RuntimeParamsTab').then(
      (mod) => mod.default,
    ),
  { loading: () => <AdminContentSkeleton /> },
);
const UserConfig = dynamic(
  () =>
    import('@/features/admin/components/tabs/UserConfigTab').then(
      (mod) => mod.default,
    ),
  { loading: () => <AdminContentSkeleton /> },
);
const ReviewsTab = dynamic(
  () => import('@/features/admin/components/tabs/ReviewsTab'),
  { loading: () => <AdminContentSkeleton /> },
);
const VideoSourceConfig = dynamic(
  () =>
    import('@/features/admin/components/tabs/VideoSourceConfigTab').then(
      (mod) => mod.default,
    ),
  { loading: () => <AdminContentSkeleton /> },
);

interface AdminTabContentProps {
  activeTab: AdminTabId;
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
  onSiteConfigSavingChange?: (saving: boolean) => void;
  onRuntimeParamsSavingChange?: (saving: boolean) => void;
  onConfigFileSavingChange?: (saving: boolean) => void;
  onSiteConfigDirtyChange?: (dirty: boolean) => void;
  onRuntimeParamsDirtyChange?: (dirty: boolean) => void;
  onConfigFileDirtyChange?: (dirty: boolean) => void;
}

const AdminTabBody = ({
  activeTab,
  config,
  role,
  refreshConfig,
  onSiteConfigSavingChange,
  onRuntimeParamsSavingChange,
  onConfigFileSavingChange,
  onSiteConfigDirtyChange,
  onRuntimeParamsDirtyChange,
  onConfigFileDirtyChange,
}: AdminTabContentProps) => {
  switch (activeTab) {
    case 'config-file':
      return (
        <ConfigFileComponent
          config={config}
          refreshConfig={refreshConfig}
          onSavingChange={onConfigFileSavingChange}
          onDirtyChange={onConfigFileDirtyChange}
        />
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
    case 'reviews':
      return <ReviewsTab />;
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

export default function AdminTabContent(props: AdminTabContentProps) {
  return (
    <AdminSkeletonContext.Provider
      value={{ activeTab: props.activeTab, config: props.config }}
    >
      <AdminTabBody {...props} />
    </AdminSkeletonContext.Provider>
  );
}

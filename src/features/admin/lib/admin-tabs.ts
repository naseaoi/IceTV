import {
  Database,
  FileText,
  FolderOpen,
  Settings,
  SlidersHorizontal,
  Tv,
  Users,
  Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AdminTabId =
  | 'config-file'
  | 'site'
  | 'runtime'
  | 'user'
  | 'video-source'
  | 'live-source'
  | 'category'
  | 'data-migration';

export interface AdminTabMeta {
  id: AdminTabId;
  label: string;
  icon: LucideIcon;
  ownerOnly: boolean;
}

export const ADMIN_TABS: AdminTabMeta[] = [
  { id: 'config-file', label: '配置文件', icon: FileText, ownerOnly: true },
  { id: 'site', label: '站点配置', icon: Settings, ownerOnly: false },
  {
    id: 'runtime',
    label: '运行参数',
    icon: SlidersHorizontal,
    ownerOnly: false,
  },
  { id: 'user', label: '用户配置', icon: Users, ownerOnly: false },
  { id: 'video-source', label: '视频源配置', icon: Video, ownerOnly: false },
  { id: 'live-source', label: '直播源配置', icon: Tv, ownerOnly: false },
  { id: 'category', label: '分类配置', icon: FolderOpen, ownerOnly: false },
  { id: 'data-migration', label: '数据迁移', icon: Database, ownerOnly: true },
];

export const DEFAULT_ADMIN_TAB: AdminTabId = 'site';

export function getVisibleTabs(isOwnerRole: boolean): AdminTabMeta[] {
  return ADMIN_TABS.filter((tab) => isOwnerRole || !tab.ownerOnly);
}

export function resolveTabId(
  raw: string | null,
  isOwnerRole: boolean,
): AdminTabId {
  const visible = getVisibleTabs(isOwnerRole);
  const matched = visible.find((tab) => tab.id === raw);
  return matched ? matched.id : DEFAULT_ADMIN_TAB;
}

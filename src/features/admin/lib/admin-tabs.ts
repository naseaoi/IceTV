import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  FolderOpen,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  Settings,
  SlidersHorizontal,
  Tv,
  Users,
  Video,
} from 'lucide-react';

export type AdminTabId =
  | 'config-file'
  | 'site'
  | 'announcements'
  | 'runtime'
  | 'user'
  | 'reviews'
  | 'danmaku'
  | 'video-source'
  | 'live-source'
  | 'category';

export type AdminTabGroupId = 'site' | 'content' | 'community' | 'maintenance';

export interface AdminTabMeta {
  id: AdminTabId;
  label: string;
  icon: LucideIcon;
  group: AdminTabGroupId;
  ownerOnly: boolean;
}

export interface AdminTabGroup {
  id: AdminTabGroupId;
  label: string;
  tabs: AdminTabMeta[];
}

const ADMIN_TAB_GROUP_LABELS: Record<AdminTabGroupId, string> = {
  site: '站点',
  content: '内容',
  community: '社区',
  maintenance: '维护',
};

// 顺序即导航顺序，同组相邻
export const ADMIN_TABS: AdminTabMeta[] = [
  {
    id: 'site',
    label: '站点设置',
    icon: Settings,
    group: 'site',
    ownerOnly: false,
  },
  {
    id: 'announcements',
    label: '公告',
    icon: Megaphone,
    group: 'site',
    ownerOnly: false,
  },
  {
    id: 'runtime',
    label: '运行参数',
    icon: SlidersHorizontal,
    group: 'site',
    ownerOnly: false,
  },
  {
    id: 'video-source',
    label: '视频源',
    icon: Video,
    group: 'content',
    ownerOnly: false,
  },
  {
    id: 'live-source',
    label: '直播源',
    icon: Tv,
    group: 'content',
    ownerOnly: false,
  },
  {
    id: 'category',
    label: '分类',
    icon: FolderOpen,
    group: 'content',
    ownerOnly: false,
  },
  {
    id: 'user',
    label: '用户',
    icon: Users,
    group: 'community',
    ownerOnly: false,
  },
  {
    id: 'reviews',
    label: '评价管理',
    icon: MessageSquare,
    group: 'community',
    ownerOnly: false,
  },
  {
    id: 'danmaku',
    label: '弹幕管理',
    icon: MessageSquareText,
    group: 'community',
    ownerOnly: false,
  },
  {
    id: 'config-file',
    label: '配置文件',
    icon: FileText,
    group: 'maintenance',
    ownerOnly: true,
  },
];

export const DEFAULT_ADMIN_TAB: AdminTabId = 'site';

export function getVisibleTabs(isOwnerRole: boolean): AdminTabMeta[] {
  return ADMIN_TABS.filter((tab) => isOwnerRole || !tab.ownerOnly);
}

export function groupAdminTabs(tabs: AdminTabMeta[]): AdminTabGroup[] {
  const groups: AdminTabGroup[] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last?.id === tab.group) last.tabs.push(tab);
    else
      groups.push({
        id: tab.group,
        label: ADMIN_TAB_GROUP_LABELS[tab.group],
        tabs: [tab],
      });
  }
  return groups;
}

export function resolveTabId(
  raw: string | null,
  isOwnerRole: boolean,
): AdminTabId {
  const visible = getVisibleTabs(isOwnerRole);
  const matched = visible.find((tab) => tab.id === raw);
  return matched ? matched.id : DEFAULT_ADMIN_TAB;
}

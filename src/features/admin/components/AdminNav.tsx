'use client';

import {
  type AdminTabId,
  type AdminTabMeta,
} from '@/features/admin/lib/admin-tabs';

interface AdminNavProps {
  tabs: AdminTabMeta[];
  activeTab: AdminTabId;
  onSelect: (tab: AdminTabId) => void;
}

const baseItem =
  'relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg border transition-all';
const activeItem =
  'z-10 -mb-px border-gray-200 border-b-transparent bg-white/80 px-6 py-3 text-base font-semibold text-green-700 backdrop-blur-md dark:border-gray-700 dark:border-b-transparent dark:bg-gray-800/50 dark:text-green-300';
const idleItem =
  'border-transparent bg-gray-100/70 px-5 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-200/70 hover:text-gray-700 dark:bg-gray-800/30 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200';

const AdminNav = ({ tabs, activeTab, onSelect }: AdminNavProps) => {
  return (
    <nav
      aria-label='管理导航'
      className='flex h-[52px] items-end gap-1.5 overflow-x-auto pr-1'
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type='button'
            onClick={() => onSelect(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`${baseItem} ${isActive ? activeItem : idleItem}`}
          >
            <Icon size={isActive ? 20 : 17} className='shrink-0' />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};

export default AdminNav;

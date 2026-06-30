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
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';
const activeItem =
  'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300';
const idleItem =
  'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60';

const AdminNav = ({ tabs, activeTab, onSelect }: AdminNavProps) => {
  return (
    <nav
      aria-label='管理导航'
      className='flex gap-2 overflow-x-auto md:flex-col md:gap-1 md:overflow-visible'
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
            className={`${baseItem} shrink-0 whitespace-nowrap md:w-full ${
              isActive ? activeItem : idleItem
            }`}
          >
            <Icon size={18} className='shrink-0' />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};

export default AdminNav;

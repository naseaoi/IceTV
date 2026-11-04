'use client';

import {
  type AdminTabId,
  type AdminTabMeta,
  groupAdminTabs,
} from '@/features/admin/lib/admin-tabs';

interface AdminNavProps {
  tabs: AdminTabMeta[];
  activeTab: AdminTabId;
  onSelect: (tab: AdminTabId) => void;
  counts?: Partial<Record<AdminTabId, number>>;
  dirtyTab?: AdminTabId | null;
}

const itemBase =
  'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm transition-colors md:h-9 md:w-full md:gap-2.5 md:rounded-lg';
const itemActive =
  'bg-brand-600 font-medium text-white md:bg-brand-50 md:text-brand-700 dark:md:bg-brand-500/10 dark:md:text-brand-300';
const itemIdle =
  'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300 md:bg-transparent md:hover:bg-gray-100 md:hover:text-gray-900 dark:md:bg-transparent dark:md:text-gray-400 dark:md:hover:bg-white/[0.06] dark:md:hover:text-gray-100';

// 窄屏为横向胶囊条，md 起为按组排列的侧栏
export default function AdminNav({
  tabs,
  activeTab,
  onSelect,
  counts = {},
  dirtyTab = null,
}: AdminNavProps) {
  const groups = groupAdminTabs(tabs);

  return (
    <nav
      aria-label='管理导航'
      className='-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-8 sm:px-8 md:mx-0 md:w-52 md:shrink-0 md:overflow-visible md:px-0 lg:w-56 [&::-webkit-scrollbar]:hidden'
    >
      <div className='flex w-max gap-2 pb-1 md:sticky md:top-24 md:block md:w-auto md:space-y-5 md:pb-0'>
        {groups.map((group) => (
          <div key={group.id} className='flex gap-2 md:block'>
            <p className='hidden px-3 pb-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 md:block'>
              {group.label}
            </p>
            <ul className='flex gap-2 md:block md:space-y-0.5'>
              {group.tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                const count = counts[tab.id];
                return (
                  <li key={tab.id}>
                    <button
                      type='button'
                      onClick={() => onSelect(tab.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`${itemBase} ${isActive ? itemActive : itemIdle}`}
                    >
                      <Icon
                        aria-hidden='true'
                        className='h-3.5 w-3.5 shrink-0 md:h-4 md:w-4'
                      />
                      <span className='md:min-w-0 md:flex-1 md:truncate md:text-left'>
                        {tab.label}
                      </span>
                      {dirtyTab === tab.id && (
                        <span
                          title='有未保存的改动'
                          className='h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500'
                        />
                      )}
                      {count !== undefined && (
                        <span
                          aria-hidden='true'
                          className={`hidden text-xs tabular-nums md:inline ${
                            isActive
                              ? 'text-brand-600/80 dark:text-brand-300/80'
                              : 'text-gray-400 dark:text-gray-500'
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

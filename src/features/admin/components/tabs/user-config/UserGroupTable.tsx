'use client';

import AdminRowMenu from '@/features/admin/components/AdminRowMenu';

interface UserGroup {
  name: string;
  enabledApis?: string[];
  allowLive?: boolean;
}

interface UserGroupTableProps {
  userGroups: UserGroup[];
  showLiveAccess: boolean;
  isEditLoading: (groupName: string) => boolean;
  onEdit: (group: UserGroup) => void;
  onDelete: (groupName: string) => void;
}

export function UserGroupTable({
  userGroups,
  showLiveAccess,
  isEditLoading,
  onEdit,
  onDelete,
}: UserGroupTableProps) {
  return (
    <div className='overflow-hidden rounded-xl ring-1 ring-gray-200 dark:ring-white/[0.06]'>
      {userGroups.length === 0 ? (
        <p className='bg-white px-3 py-8 text-center text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400'>
          暂无用户组
        </p>
      ) : (
        <ul
          aria-label='用户组'
          className='divide-y divide-gray-200 dark:divide-white/[0.06]'
        >
          {userGroups.map((group) => (
            <li
              key={group.name}
              className='flex items-center gap-3 bg-white px-3 py-3 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-white/[0.02]'
            >
              <div className='min-w-0 flex-1'>
                <p
                  title={group.name}
                  className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
                >
                  {group.name}
                </p>
                <p className='mt-1 truncate text-xs text-gray-500 dark:text-gray-400'>
                  可用视频源:{' '}
                  {group.enabledApis?.length
                    ? `${group.enabledApis.length} 个`
                    : '无限制'}
                  {showLiveAccess && group.allowLive && ' · 可看直播'}
                </p>
              </div>
              <div className='shrink-0'>
                <AdminRowMenu
                  label={`${group.name} 的操作`}
                  items={[
                    {
                      label: '编辑',
                      onSelect: () => onEdit(group),
                      disabled: isEditLoading(group.name),
                    },
                    {
                      label: '删除',
                      onSelect: () => onDelete(group.name),
                      danger: true,
                    },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

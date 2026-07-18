'use client';

import { ResizableTableHeader } from '@/features/admin/components/ResizableTableHeader';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface UserGroup {
  name: string;
  enabledApis?: string[];
}

interface UserGroupTableProps {
  userGroups: UserGroup[];
  isEditLoading: (groupName: string) => boolean;
  onEdit: (group: UserGroup) => void;
  onDelete: (groupName: string) => void;
}

export function UserGroupTable({
  userGroups,
  isEditLoading,
  onEdit,
  onDelete,
}: UserGroupTableProps) {
  return (
    <div
      className='relative max-h-[20rem] overflow-x-auto overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700'
      data-table='user-group-list'
    >
      <table className='w-full table-fixed divide-y divide-gray-200 dark:divide-gray-700'>
        <thead className='sticky top-0 z-10 bg-gray-50 dark:bg-gray-900'>
          <tr>
            <ResizableTableHeader
              tableId='user-group-list'
              columnId='name'
              defaultWidth={359}
              minWidth={120}
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              用户组名称
            </ResizableTableHeader>
            <ResizableTableHeader
              tableId='user-group-list'
              columnId='source-permissions'
              defaultWidth={867}
              minWidth={120}
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              可用视频源
            </ResizableTableHeader>
            <ResizableTableHeader
              tableId='user-group-list'
              columnId='actions'
              defaultWidth={364}
              minWidth={160}
              hideDivider
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              操作
            </ResizableTableHeader>
          </tr>
        </thead>
        <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
          {userGroups.map((group) => (
            <tr
              key={group.name}
              className='transition-colors hover:bg-gray-50 dark:hover:bg-gray-800'
            >
              <td className='whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100'>
                {group.name}
              </td>
              <td className='whitespace-nowrap px-6 py-4'>
                <div className='flex items-center space-x-2'>
                  <span className='text-sm text-gray-900 dark:text-gray-100'>
                    {group.enabledApis && group.enabledApis.length > 0
                      ? `${group.enabledApis.length} 个源`
                      : '无限制'}
                  </span>
                </div>
              </td>
              <td className='space-x-2 whitespace-nowrap px-6 py-4 text-left text-sm font-medium'>
                <button
                  onClick={() => onEdit(group)}
                  disabled={isEditLoading(group.name)}
                  className={`${buttonStyles.roundedPrimary} ${
                    isEditLoading(group.name)
                      ? 'cursor-not-allowed opacity-50'
                      : ''
                  }`}
                >
                  编辑
                </button>
                <button
                  onClick={() => onDelete(group.name)}
                  className={buttonStyles.roundedDanger}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
          {userGroups.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className='px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400'
              >
                暂无用户组，请添加用户组来管理用户权限
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

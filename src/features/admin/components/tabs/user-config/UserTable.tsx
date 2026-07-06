'use client';

import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import {
  type PermissionContext,
  canChangeUserPassword,
  canConfigureUser,
  canDeleteManagedUser,
  canOperateUser,
} from '@/features/admin/lib/permissions';

interface User {
  username: string;
  role: 'user' | 'admin' | 'owner';
  banned?: boolean;
  enabledApis?: string[];
  tags?: string[];
}

interface UserTableProps {
  users: User[];
  currentUsername: string | null;
  permissionContext: PermissionContext;
  selectableUsersCount: number;
  selectedUsers: Set<string>;
  selectAllUsers: boolean;
  isLoading: (key: string) => boolean;
  onSelectAllUsers: (checked: boolean) => void;
  onSelectUser: (username: string, checked: boolean) => void;
  onConfigureUserGroup: (user: User) => void;
  onConfigureUserApis: (user: User) => void;
  onShowChangePassword: (username: string) => void;
  onSetAdmin: (username: string) => void;
  onRemoveAdmin: (username: string) => void;
  onBanUser: (username: string) => void;
  onUnbanUser: (username: string) => void;
  onDeleteUser: (username: string) => void;
}

export function UserTable({
  users,
  currentUsername,
  permissionContext,
  selectableUsersCount,
  selectedUsers,
  selectAllUsers,
  isLoading,
  onSelectAllUsers,
  onSelectUser,
  onConfigureUserGroup,
  onConfigureUserApis,
  onShowChangePassword,
  onSetAdmin,
  onRemoveAdmin,
  onBanUser,
  onUnbanUser,
  onDeleteUser,
}: UserTableProps) {
  // 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他
  const sortedUsers = [...users].sort((a, b) => {
    const priority = (u: User) => {
      if (u.username === currentUsername) return 0;
      if (u.role === 'owner') return 1;
      if (u.role === 'admin') return 2;
      return 3;
    };
    return priority(a) - priority(b);
  });

  return (
    <div
      className='relative overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700'
      data-table='user-list'
    >
      <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
        <thead className='sticky top-0 z-10 bg-gray-50 dark:bg-gray-900'>
          <tr>
            <th className='w-4' />
            <th className='w-10 px-1 py-3 text-center'>
              {selectableUsersCount > 0 ? (
                <input
                  type='checkbox'
                  checked={selectAllUsers}
                  onChange={(e) => onSelectAllUsers(e.target.checked)}
                  className='h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 accent-blue-600 checked:border-blue-600 checked:bg-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:accent-blue-500 dark:ring-offset-gray-800 dark:checked:border-blue-500 dark:checked:bg-blue-500 dark:focus:ring-blue-600'
                />
              ) : (
                <div className='h-4 w-4' />
              )}
            </th>
            <th
              scope='col'
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              用户名
            </th>
            <th
              scope='col'
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              角色
            </th>
            <th
              scope='col'
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              状态
            </th>
            <th
              scope='col'
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              用户组
            </th>
            <th
              scope='col'
              className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              采集源权限
            </th>
            <th
              scope='col'
              className='px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
            >
              操作
            </th>
          </tr>
        </thead>
        <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
          {sortedUsers.map((user) => {
            const canConfigure = canConfigureUser(user, permissionContext);
            const canChangePassword = canChangeUserPassword(
              user,
              permissionContext,
            );
            const canDeleteUser = canDeleteManagedUser(user, permissionContext);
            const canOperate = canOperateUser(user, permissionContext);
            return (
              <tr
                key={user.username}
                className='transition-colors hover:bg-gray-50 dark:hover:bg-gray-800'
              >
                <td className='w-4' />
                <td className='w-10 px-1 py-3 text-center'>
                  {canConfigure ? (
                    <input
                      type='checkbox'
                      checked={selectedUsers.has(user.username)}
                      onChange={(e) =>
                        onSelectUser(user.username, e.target.checked)
                      }
                      className='h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 accent-blue-600 checked:border-blue-600 checked:bg-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:accent-blue-500 dark:ring-offset-gray-800 dark:checked:border-blue-500 dark:checked:bg-blue-500 dark:focus:ring-blue-600'
                    />
                  ) : (
                    <div className='h-4 w-4' />
                  )}
                </td>
                <td className='whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100'>
                  {user.username}
                </td>
                <td className='whitespace-nowrap px-6 py-4'>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      user.role === 'owner'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
                        : user.role === 'admin'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {user.role === 'owner'
                      ? '站长'
                      : user.role === 'admin'
                        ? '管理员'
                        : '普通用户'}
                  </span>
                </td>
                <td className='whitespace-nowrap px-6 py-4'>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      !user.banned
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
                    }`}
                  >
                    {!user.banned ? '正常' : '已封禁'}
                  </span>
                </td>
                <td className='whitespace-nowrap px-6 py-4'>
                  <div className='flex items-center space-x-2'>
                    <span className='text-sm text-gray-900 dark:text-gray-100'>
                      {user.tags && user.tags.length > 0
                        ? user.tags.join(', ')
                        : '无用户组'}
                    </span>
                    {canConfigure && (
                      <button
                        onClick={() => onConfigureUserGroup(user)}
                        className={buttonStyles.roundedPrimary}
                      >
                        配置
                      </button>
                    )}
                  </div>
                </td>
                <td className='whitespace-nowrap px-6 py-4'>
                  <div className='flex items-center space-x-2'>
                    <span className='text-sm text-gray-900 dark:text-gray-100'>
                      {user.enabledApis && user.enabledApis.length > 0
                        ? `${user.enabledApis.length} 个源`
                        : '无限制'}
                    </span>
                    {canConfigure && (
                      <button
                        onClick={() => onConfigureUserApis(user)}
                        className={buttonStyles.roundedPrimary}
                      >
                        配置
                      </button>
                    )}
                  </div>
                </td>
                <td className='space-x-2 whitespace-nowrap px-6 py-4 text-right text-sm font-medium'>
                  {canChangePassword && (
                    <button
                      onClick={() => onShowChangePassword(user.username)}
                      className={buttonStyles.roundedPrimary}
                    >
                      修改密码
                    </button>
                  )}
                  {canOperate && (
                    <>
                      {user.role === 'user' && (
                        <button
                          onClick={() => onSetAdmin(user.username)}
                          disabled={isLoading(`setAdmin_${user.username}`)}
                          className={`${buttonStyles.roundedPurple} ${
                            isLoading(`setAdmin_${user.username}`)
                              ? 'cursor-not-allowed opacity-50'
                              : ''
                          }`}
                        >
                          设为管理
                        </button>
                      )}
                      {user.role === 'admin' && (
                        <button
                          onClick={() => onRemoveAdmin(user.username)}
                          disabled={isLoading(`removeAdmin_${user.username}`)}
                          className={`${buttonStyles.roundedSecondary} ${
                            isLoading(`removeAdmin_${user.username}`)
                              ? 'cursor-not-allowed opacity-50'
                              : ''
                          }`}
                        >
                          取消管理
                        </button>
                      )}
                      {user.role !== 'owner' &&
                        (!user.banned ? (
                          <button
                            onClick={() => onBanUser(user.username)}
                            disabled={isLoading(`banUser_${user.username}`)}
                            className={`${buttonStyles.roundedDanger} ${
                              isLoading(`banUser_${user.username}`)
                                ? 'cursor-not-allowed opacity-50'
                                : ''
                            }`}
                          >
                            封禁
                          </button>
                        ) : (
                          <button
                            onClick={() => onUnbanUser(user.username)}
                            disabled={isLoading(`unbanUser_${user.username}`)}
                            className={`${buttonStyles.roundedSuccess} ${
                              isLoading(`unbanUser_${user.username}`)
                                ? 'cursor-not-allowed opacity-50'
                                : ''
                            }`}
                          >
                            解封
                          </button>
                        ))}
                    </>
                  )}
                  {canDeleteUser && (
                    <button
                      onClick={() => onDeleteUser(user.username)}
                      className={buttonStyles.roundedDanger}
                    >
                      删除用户
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import AdminRowMenu, {
  type AdminRowMenuItem,
} from '@/features/admin/components/AdminRowMenu';
import {
  buttonStyles,
  checkboxStyles,
} from '@/features/admin/lib/buttonStyles';
import {
  type PermissionContext,
  canChangeUserPassword,
  canConfigureUser,
  canDeleteManagedUser,
  canOperateUser,
} from '@/features/admin/lib/permissions';
import {
  formatLastActive,
  formatLastActiveTooltip,
} from '@/features/admin/lib/userActivity';

interface User {
  username: string;
  nickname?: string | null;
  role: 'user' | 'admin' | 'owner';
  banned?: boolean;
  enabledApis?: string[];
  tags?: string[];
}

interface UserTableProps {
  users: User[];
  total?: number;
  selectedCount?: number;
  lastActiveAt: Record<string, number>;
  currentUsername: string | null;
  permissionContext: PermissionContext;
  selectableUsersCount: number;
  selectedUsers: Set<string>;
  selectAllUsers: boolean;
  isLoading: (key: string) => boolean;
  onBatchUserGroup: () => void;
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
  total = users.length,
  selectedCount,
  lastActiveAt,
  currentUsername,
  permissionContext,
  selectableUsersCount,
  selectedUsers,
  selectAllUsers,
  isLoading,
  onBatchUserGroup,
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
  const selectionCount = selectedCount ?? selectedUsers.size;

  return (
    <div className='overflow-hidden rounded-xl ring-1 ring-gray-200 dark:ring-white/[0.06]'>
      <div className='flex h-10 items-center gap-3 bg-gray-50 px-3 dark:bg-white/[0.03]'>
        {selectableUsersCount > 0 ? (
          <input
            type='checkbox'
            aria-label='全选当前用户'
            checked={selectAllUsers}
            onChange={(event) => onSelectAllUsers(event.target.checked)}
            className={`${checkboxStyles} shrink-0`}
          />
        ) : (
          <span className='h-4 w-4 shrink-0' />
        )}
        <span className='text-xs text-gray-500 dark:text-gray-400'>
          共 {total} 人
          {selectionCount > 0 ? ` · 已选 ${selectionCount} 人` : ''}
        </span>
        {selectionCount > 0 && (
          <button
            type='button'
            onClick={onBatchUserGroup}
            className={`${buttonStyles.outline} ml-auto`}
          >
            批量设置用户组
          </button>
        )}
      </div>
      {users.length === 0 ? (
        <p className='bg-white px-3 py-12 text-center text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400'>
          没有匹配的用户
        </p>
      ) : (
        <ul
          aria-label='用户列表'
          className='divide-y divide-gray-200 dark:divide-white/[0.06]'
        >
          {users.map((user) => {
            const canConfigure = canConfigureUser(user, permissionContext);
            const items: AdminRowMenuItem[] = [];
            if (canConfigure) {
              items.push(
                {
                  label: '配置用户组',
                  onSelect: () => onConfigureUserGroup(user),
                  disabled: isLoading(`saveUserGroups_${user.username}`),
                },
                {
                  label: '配置视频源',
                  onSelect: () => onConfigureUserApis(user),
                  disabled: isLoading(`saveUserApis_${user.username}`),
                },
              );
            }
            if (canChangeUserPassword(user, permissionContext)) {
              items.push({
                label: '修改密码',
                onSelect: () => onShowChangePassword(user.username),
                disabled: isLoading(`changePassword_${user.username}`),
              });
            }
            if (canOperateUser(user, permissionContext)) {
              if (user.role === 'user') {
                items.push({
                  label: '设为管理',
                  onSelect: () => onSetAdmin(user.username),
                  disabled: isLoading(`setAdmin_${user.username}`),
                });
              } else if (user.role === 'admin') {
                items.push({
                  label: '取消管理',
                  onSelect: () => onRemoveAdmin(user.username),
                  disabled: isLoading(`removeAdmin_${user.username}`),
                });
              }
              if (user.role !== 'owner') {
                items.push(
                  user.banned
                    ? {
                        label: '解封',
                        onSelect: () => onUnbanUser(user.username),
                        disabled: isLoading(`unbanUser_${user.username}`),
                      }
                    : {
                        label: '封禁',
                        onSelect: () => onBanUser(user.username),
                        danger: true,
                        disabled: isLoading(`ban_${user.username}`),
                      },
                );
              }
            }
            if (canDeleteManagedUser(user, permissionContext)) {
              items.push({
                label: '删除用户',
                onSelect: () => onDeleteUser(user.username),
                danger: true,
                disabled: isLoading(`deleteUser_${user.username}`),
              });
            }
            return (
              <li
                key={user.username}
                className='flex items-center gap-3 bg-white px-3 py-3 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-white/[0.02]'
              >
                {canConfigure &&
                user.role !== 'owner' &&
                user.username !== currentUsername ? (
                  <input
                    type='checkbox'
                    aria-label={`选择用户 ${user.username}`}
                    checked={selectedUsers.has(user.username)}
                    onChange={(event) =>
                      onSelectUser(user.username, event.target.checked)
                    }
                    className={`${checkboxStyles} shrink-0`}
                  />
                ) : (
                  <span className='h-4 w-4 shrink-0' />
                )}
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <span
                      title={user.username}
                      className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
                    >
                      {user.username}
                      {user.nickname && (
                        <span className='ml-2 font-normal text-gray-500'>
                          {user.nickname}
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        user.role === 'owner'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                          : user.role === 'admin'
                            ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/20 dark:text-brand-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {user.role === 'owner'
                        ? '站长'
                        : user.role === 'admin'
                          ? '管理员'
                          : '普通用户'}
                    </span>
                    {user.banned && (
                      <span className='shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-900/20 dark:text-red-300'>
                        已封禁
                      </span>
                    )}
                    {user.username === currentUsername && (
                      <span className='shrink-0 text-xs text-gray-400'>我</span>
                    )}
                  </div>
                  <p className='mt-1 truncate text-xs text-gray-500 dark:text-gray-400'>
                    <span
                      title={formatLastActiveTooltip(
                        lastActiveAt[user.username],
                      )}
                    >
                      最后活跃 {formatLastActive(lastActiveAt[user.username])}
                    </span>
                    {' · 用户组 '}
                    {user.tags?.length ? user.tags.join(', ') : '无'}
                    {' · 视频源 '}
                    {user.enabledApis?.length
                      ? `${user.enabledApis.length} 个`
                      : '无限制'}
                  </p>
                </div>
                <div className='shrink-0'>
                  <AdminRowMenu
                    label={`${user.username} 的操作`}
                    items={items}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

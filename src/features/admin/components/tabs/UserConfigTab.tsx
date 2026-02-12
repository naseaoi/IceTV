'use client';

import { useCallback, useMemo, useState } from 'react';

import AdminDialog from '@/features/admin/components/AdminDialog';
import AlertModal from '@/features/admin/components/AlertModal';
import ConfirmModal from '@/features/admin/components/ConfirmModal';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { useAlertModal } from '@/features/admin/hooks/useAlertModal';
import { useAdminUserActions } from '@/features/admin/hooks/useAdminUserActions';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { AdminConfig } from '@/features/admin/types/api';
import {
  canChangeUserPassword,
  canConfigureUser,
  canDeleteManagedUser,
  canOperateUser,
  getSelectableUsers,
} from '@/features/admin/lib/permissions';
import { useModalState } from '@/hooks/useModalState';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const {
    userGroupAction,
    assignUserGroups,
    batchUpdateUserGroups,
    updateUserApis,
    userAction,
  } = useAdminUserActions({
    refreshConfig,
    showAlert,
  });
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [showAddUserGroupForm, setShowAddUserGroupForm] = useModalState(false);
  const [showEditUserGroupForm, setShowEditUserGroupForm] =
    useModalState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    userGroup: '', // 新增用户组字段
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  const [newUserGroup, setNewUserGroup] = useState({
    name: '',
    enabledApis: [] as string[],
  });
  const [editingUserGroup, setEditingUserGroup] = useState<{
    name: string;
    enabledApis: string[];
  } | null>(null);
  const [showConfigureApisModal, setShowConfigureApisModal] =
    useModalState(false);
  const [selectedUser, setSelectedUser] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
    tags?: string[];
  } | null>(null);
  const [selectedApis, setSelectedApis] = useState<string[]>([]);
  const [showConfigureUserGroupModal, setShowConfigureUserGroupModal] =
    useModalState(false);
  const [selectedUserForGroup, setSelectedUserForGroup] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  } | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showBatchUserGroupModal, setShowBatchUserGroupModal] =
    useModalState(false);
  const [selectedUserGroup, setSelectedUserGroup] = useState<string>('');
  const [showDeleteUserGroupModal, setShowDeleteUserGroupModal] =
    useModalState(false);
  const [deletingUserGroup, setDeletingUserGroup] = useState<{
    name: string;
    affectedUsers: Array<{
      username: string;
      role: 'user' | 'admin' | 'owner';
    }>;
  } | null>(null);
  const [showDeleteUserModal, setShowDeleteUserModal] = useModalState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // 当前登录用户名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;
  const permissionContext = useMemo(
    () => ({ role, currentUsername }),
    [role, currentUsername],
  );

  // 使用 useMemo 计算全选状态，避免每次渲染都重新计算
  const selectAllUsers = useMemo(() => {
    const selectableUserCount = getSelectableUsers(
      config?.UserConfig?.Users || [],
      permissionContext,
    ).length;
    return selectedUsers.size === selectableUserCount && selectedUsers.size > 0;
  }, [selectedUsers.size, config?.UserConfig?.Users, permissionContext]);

  // 获取用户组列表
  const userGroups = config?.UserConfig?.Tags || [];

  // 处理用户组相关操作
  const handleUserGroupAction = async (
    action: 'add' | 'edit' | 'delete',
    groupName: string,
    enabledApis?: string[],
  ) => {
    return withLoading(`userGroup_${action}_${groupName}`, async () => {
      try {
        await userGroupAction(action, groupName, enabledApis);

        if (action === 'add') {
          setNewUserGroup({ name: '', enabledApis: [] });
          setShowAddUserGroupForm(false);
        } else if (action === 'edit') {
          setEditingUserGroup(null);
          setShowEditUserGroupForm(false);
        }

        showSuccess(
          action === 'add'
            ? '用户组添加成功'
            : action === 'edit'
              ? '用户组更新成功'
              : '用户组删除成功',
          showAlert,
        );
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleAddUserGroup = () => {
    if (!newUserGroup.name.trim()) return;
    handleUserGroupAction('add', newUserGroup.name, newUserGroup.enabledApis);
  };

  const handleEditUserGroup = () => {
    if (!editingUserGroup?.name.trim()) return;
    handleUserGroupAction(
      'edit',
      editingUserGroup.name,
      editingUserGroup.enabledApis,
    );
  };

  const handleDeleteUserGroup = (groupName: string) => {
    // 计算会受影响的用户数量
    const affectedUsers =
      config?.UserConfig?.Users?.filter(
        (user) => user.tags && user.tags.includes(groupName),
      ) || [];

    setDeletingUserGroup({
      name: groupName,
      affectedUsers: affectedUsers.map((u) => ({
        username: u.username,
        role: u.role,
      })),
    });
    setShowDeleteUserGroupModal(true);
  };

  const handleConfirmDeleteUserGroup = async () => {
    if (!deletingUserGroup) return;

    try {
      await handleUserGroupAction('delete', deletingUserGroup.name);
      setShowDeleteUserGroupModal(false);
      setDeletingUserGroup(null);
    } catch (err) {
      // 错误处理已在 handleUserGroupAction 中处理
    }
  };

  const handleStartEditUserGroup = (group: {
    name: string;
    enabledApis: string[];
  }) => {
    setEditingUserGroup({ ...group });
    setShowEditUserGroupForm(true);
    setShowAddUserGroupForm(false);
  };

  // 为用户分配用户组
  const handleAssignUserGroup = async (
    username: string,
    userGroups: string[],
  ) => {
    return withLoading(`assignUserGroup_${username}`, async () => {
      try {
        await assignUserGroups(username, userGroups);
        showSuccess('用户组分配成功', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleBanUser = async (uname: string) => {
    await withLoading(`banUser_${uname}`, () => handleUserAction('ban', uname));
  };

  const handleUnbanUser = async (uname: string) => {
    await withLoading(`unbanUser_${uname}`, () =>
      handleUserAction('unban', uname),
    );
  };

  const handleToggleOpenRegister = async () => {
    await withLoading('setOpenRegister', async () => {
      try {
        await userAction(
          'setOpenRegister',
          undefined,
          undefined,
          undefined,
          !(config?.UserConfig?.OpenRegister ?? false),
        );
        showSuccess('开放注册设置已更新', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '更新失败', showAlert);
        throw err;
      }
    });
  };

  const handleSetAdmin = async (uname: string) => {
    await withLoading(`setAdmin_${uname}`, () =>
      handleUserAction('setAdmin', uname),
    );
  };

  const handleRemoveAdmin = async (uname: string) => {
    await withLoading(`removeAdmin_${uname}`, () =>
      handleUserAction('cancelAdmin', uname),
    );
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await withLoading('addUser', async () => {
      await handleUserAction(
        'add',
        newUser.username,
        newUser.password,
        newUser.userGroup,
      );
      setNewUser({ username: '', password: '', userGroup: '' });
      setShowAddUserForm(false);
    });
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await withLoading(
      `changePassword_${changePasswordUser.username}`,
      async () => {
        await handleUserAction(
          'changePassword',
          changePasswordUser.username,
          changePasswordUser.password,
        );
        setChangePasswordUser({ username: '', password: '' });
        setShowChangePasswordForm(false);
      },
    );
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 关闭添加用户表单
  };

  const handleDeleteUser = (username: string) => {
    setDeletingUser(username);
    setShowDeleteUserModal(true);
  };

  const handleConfigureUserApis = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
  }) => {
    setSelectedUser(user);
    setSelectedApis(user.enabledApis || []);
    setShowConfigureApisModal(true);
  };

  const handleConfigureUserGroup = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  }) => {
    setSelectedUserForGroup(user);
    setSelectedUserGroups(user.tags || []);
    setShowConfigureUserGroupModal(true);
  };

  const handleSaveUserGroups = async () => {
    if (!selectedUserForGroup) return;

    await withLoading(
      `saveUserGroups_${selectedUserForGroup.username}`,
      async () => {
        try {
          await handleAssignUserGroup(
            selectedUserForGroup.username,
            selectedUserGroups,
          );
          setShowConfigureUserGroupModal(false);
          setSelectedUserForGroup(null);
          setSelectedUserGroups([]);
        } catch (err) {
          // 错误处理已在 handleAssignUserGroup 中处理
        }
      },
    );
  };

  const closeConfigureApisModal = () => {
    setShowConfigureApisModal(false);
    setSelectedUser(null);
    setSelectedApis([]);
  };

  const closeAddUserGroupModal = () => {
    setShowAddUserGroupForm(false);
    setNewUserGroup({ name: '', enabledApis: [] });
  };

  const closeEditUserGroupModal = () => {
    setShowEditUserGroupForm(false);
    setEditingUserGroup(null);
  };

  const closeConfigureUserGroupModal = () => {
    setShowConfigureUserGroupModal(false);
    setSelectedUserForGroup(null);
    setSelectedUserGroups([]);
  };

  const closeBatchUserGroupModal = () => {
    setShowBatchUserGroupModal(false);
    setSelectedUserGroup('');
  };

  // 处理用户选择
  const handleSelectUser = useCallback((username: string, checked: boolean) => {
    setSelectedUsers((prev) => {
      const newSelectedUsers = new Set(prev);
      if (checked) {
        newSelectedUsers.add(username);
      } else {
        newSelectedUsers.delete(username);
      }
      return newSelectedUsers;
    });
  }, []);

  const handleSelectAllUsers = useCallback(
    (checked: boolean) => {
      if (checked) {
        // 只选择自己有权限操作的用户
        const selectableUsernames = getSelectableUsers(
          config?.UserConfig?.Users || [],
          permissionContext,
        ).map((u) => u.username);
        setSelectedUsers(new Set(selectableUsernames));
      } else {
        setSelectedUsers(new Set());
      }
    },
    [config?.UserConfig?.Users, permissionContext],
  );

  // 批量设置用户组
  const handleBatchSetUserGroup = async (userGroup: string) => {
    if (selectedUsers.size === 0) return;

    await withLoading('batchSetUserGroup', async () => {
      try {
        await batchUpdateUserGroups(Array.from(selectedUsers), userGroup);

        const userCount = selectedUsers.size;
        setSelectedUsers(new Set());
        closeBatchUserGroupModal();
        showSuccess(
          `已为 ${userCount} 个用户设置用户组: ${userGroup}`,
          showAlert,
        );

        // 刷新配置
        await refreshConfig();
      } catch (err) {
        showError('批量设置用户组失败', showAlert);
        throw err;
      }
    });
  };

  // 提取URL域名的辅助函数
  const extractDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      // 如果URL格式不正确，返回原字符串
      return url;
    }
  };

  const handleSaveUserApis = async () => {
    if (!selectedUser) return;

    await withLoading(`saveUserApis_${selectedUser.username}`, async () => {
      try {
        await updateUserApis(selectedUser.username, selectedApis);

        // 成功后刷新配置
        await refreshConfig();
        closeConfigureApisModal();
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  // 通用请求函数
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser'
      | 'setOpenRegister',
    targetUsername: string,
    targetPassword?: string,
    userGroup?: string,
    openRegister?: boolean,
  ) => {
    try {
      await userAction(
        action,
        targetUsername,
        targetPassword,
        userGroup,
        openRegister,
      );
    } catch {
      // 错误处理已在 useAdminUserActions 中处理
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;

    await withLoading(`deleteUser_${deletingUser}`, async () => {
      try {
        await handleUserAction('deleteUser', deletingUser);
        setShowDeleteUserModal(false);
        setDeletingUser(null);
      } catch (err) {
        // 错误处理已在 handleUserAction 中处理
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 mb-1'>
        <div>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
            用户统计
          </h4>
          <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 min-h-[96px]'>
            <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
              {config.UserConfig.Users.length}
            </div>
            <div className='text-sm text-green-600 dark:text-green-400'>
              总用户数
            </div>
          </div>
        </div>
        <div>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
            注册设置
          </h4>
          <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4 min-h-[96px]'>
            <div>
              <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                开放注册
              </p>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，未注册用户可通过注册接口自行创建账号。
              </p>
            </div>
            <button
              type='button'
              onClick={handleToggleOpenRegister}
              disabled={isLoading('setOpenRegister')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.UserConfig.OpenRegister
                  ? 'bg-green-500'
                  : 'bg-gray-300 dark:bg-gray-600'
              } ${isLoading('setOpenRegister') ? 'opacity-50 cursor-not-allowed' : ''}`}
              aria-label='切换开放注册'
              aria-pressed={!!config.UserConfig.OpenRegister}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  config.UserConfig.OpenRegister
                    ? 'translate-x-5'
                    : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 用户组管理 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户组管理
          </h4>
          <button
            onClick={() => {
              setShowAddUserGroupForm(!showAddUserGroupForm);
              if (showEditUserGroupForm) {
                setShowEditUserGroupForm(false);
                setEditingUserGroup(null);
              }
            }}
            className={
              showAddUserGroupForm
                ? buttonStyles.secondary
                : buttonStyles.primary
            }
          >
            {showAddUserGroupForm ? '取消' : '添加用户组'}
          </button>
        </div>

        {/* 用户组列表 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[20rem] overflow-y-auto overflow-x-auto relative'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  用户组名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  可用视频源
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
              {userGroups.map((group) => (
                <tr
                  key={group.name}
                  className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                >
                  <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {group.name}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center space-x-2'>
                      <span className='text-sm text-gray-900 dark:text-gray-100'>
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `${group.enabledApis.length} 个源`
                          : '无限制'}
                      </span>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                    <button
                      onClick={() => handleStartEditUserGroup(group)}
                      disabled={isLoading(`userGroup_edit_${group.name}`)}
                      className={`${buttonStyles.roundedPrimary} ${
                        isLoading(`userGroup_edit_${group.name}`)
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDeleteUserGroup(group.name)}
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
      </div>

      {/* 用户列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户列表
          </h4>
          <div className='flex items-center space-x-2'>
            {/* 批量操作按钮 */}
            {selectedUsers.size > 0 && (
              <>
                <div className='flex items-center space-x-3'>
                  <span className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择 {selectedUsers.size} 个用户
                  </span>
                  <button
                    onClick={() => setShowBatchUserGroupModal(true)}
                    className={buttonStyles.primary}
                  >
                    批量设置用户组
                  </button>
                </div>
                <div className='w-px h-6 bg-gray-300 dark:bg-gray-600'></div>
              </>
            )}
            <button
              onClick={() => {
                setShowAddUserForm(!showAddUserForm);
                if (showChangePasswordForm) {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }
              }}
              className={
                showAddUserForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddUserForm ? '取消' : '添加用户'}
            </button>
          </div>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <input
                  type='text'
                  placeholder='用户名'
                  value={newUser.username}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
                <input
                  type='password'
                  placeholder='密码'
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  用户组（可选）
                </label>
                <select
                  value={newUser.userGroup}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      userGroup: e.target.value,
                    }))
                  }
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                >
                  <option value=''>无用户组（无限制）</option>
                  {userGroups.map((group) => (
                    <option key={group.name} value={group.name}>
                      {group.name} (
                      {group.enabledApis && group.enabledApis.length > 0
                        ? `${group.enabledApis.length} 个源`
                        : '无限制'}
                      )
                    </option>
                  ))}
                </select>
              </div>
              <div className='flex justify-end'>
                <button
                  onClick={handleAddUser}
                  disabled={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                  }
                  className={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                      ? buttonStyles.disabled
                      : buttonStyles.success
                  }
                >
                  {isLoading('addUser') ? '添加中...' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 修改密码表单 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改用户密码
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密码'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                }
                className={`w-full sm:w-auto ${
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                    ? buttonStyles.disabled
                    : buttonStyles.primary
                }`}
              >
                {isLoading(`changePassword_${changePasswordUser.username}`)
                  ? '修改中...'
                  : '修改密码'}
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className={`w-full sm:w-auto ${buttonStyles.secondary}`}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 用户列表 */}
        <div
          className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto relative'
          data-table='user-list'
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-4' />
                <th className='w-10 px-1 py-3 text-center'>
                  {(() => {
                    // 检查是否有权限操作任何用户
                    const hasAnyPermission =
                      getSelectableUsers(
                        config?.UserConfig?.Users || [],
                        permissionContext,
                      ).length > 0;

                    return hasAnyPermission ? (
                      <input
                        type='checkbox'
                        checked={selectAllUsers}
                        onChange={(e) => handleSelectAllUsers(e.target.checked)}
                        className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                      />
                    ) : (
                      <div className='w-4 h-4' />
                    );
                  })()}
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  状态
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户组
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  采集源权限
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  return 3;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {sortedUsers.map((user) => {
                    const canConfigure = canConfigureUser(
                      user,
                      permissionContext,
                    );
                    const canChangePassword = canChangeUserPassword(
                      user,
                      permissionContext,
                    );
                    const canDeleteUser = canDeleteManagedUser(
                      user,
                      permissionContext,
                    );
                    const canOperate = canOperateUser(user, permissionContext);
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                      >
                        <td className='w-4' />
                        <td className='w-10 px-1 py-3 text-center'>
                          {canConfigure ? (
                            <input
                              type='checkbox'
                              checked={selectedUsers.has(user.username)}
                              onChange={(e) =>
                                handleSelectUser(
                                  user.username,
                                  e.target.checked,
                                )
                              }
                              className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                            />
                          ) : (
                            <div className='w-4 h-4' />
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              user.role === 'owner'
                                ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                : user.role === 'admin'
                                  ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {user.role === 'owner'
                              ? '站长'
                              : user.role === 'admin'
                                ? '管理员'
                                : '普通用户'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              !user.banned
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {!user.banned ? '正常' : '已封禁'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-gray-900 dark:text-gray-100'>
                              {user.tags && user.tags.length > 0
                                ? user.tags.join(', ')
                                : '无用户组'}
                            </span>
                            {/* 配置用户组按钮 */}
                            {canConfigure && (
                              <button
                                onClick={() => handleConfigureUserGroup(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                配置
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-gray-900 dark:text-gray-100'>
                              {user.enabledApis && user.enabledApis.length > 0
                                ? `${user.enabledApis.length} 个源`
                                : '无限制'}
                            </span>
                            {/* 配置采集源权限按钮 */}
                            {canConfigure && (
                              <button
                                onClick={() => handleConfigureUserApis(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                配置
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密码按钮 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className={buttonStyles.roundedPrimary}
                            >
                              修改密码
                            </button>
                          )}
                          {canOperate && (
                            <>
                              {/* 其他操作按钮 */}
                              {user.role === 'user' && (
                                <button
                                  onClick={() => handleSetAdmin(user.username)}
                                  disabled={isLoading(
                                    `setAdmin_${user.username}`,
                                  )}
                                  className={`${buttonStyles.roundedPurple} ${
                                    isLoading(`setAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  设为管理
                                </button>
                              )}
                              {user.role === 'admin' && (
                                <button
                                  onClick={() =>
                                    handleRemoveAdmin(user.username)
                                  }
                                  disabled={isLoading(
                                    `removeAdmin_${user.username}`,
                                  )}
                                  className={`${
                                    buttonStyles.roundedSecondary
                                  } ${
                                    isLoading(`removeAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  取消管理
                                </button>
                              )}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    disabled={isLoading(
                                      `banUser_${user.username}`,
                                    )}
                                    className={`${buttonStyles.roundedDanger} ${
                                      isLoading(`banUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    disabled={isLoading(
                                      `unbanUser_${user.username}`,
                                    )}
                                    className={`${
                                      buttonStyles.roundedSuccess
                                    } ${
                                      isLoading(`unbanUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
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
              );
            })()}
          </table>
        </div>
      </div>

      {/* 配置用户采集源权限弹窗 */}
      {selectedUser && (
        <AdminDialog
          isOpen={showConfigureApisModal}
          title={`配置用户采集源权限 - ${selectedUser.username}`}
          onClose={closeConfigureApisModal}
          panelClassName='max-w-4xl max-h-[80vh] overflow-y-auto'
        >
          <div className='mb-6'>
            <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20'>
              <div className='mb-2 flex items-center space-x-2'>
                <svg
                  className='h-5 w-5 text-blue-600 dark:text-blue-400'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                  配置说明
                </span>
              </div>
              <p className='mt-1 text-sm text-blue-700 dark:text-blue-400'>
                提示：全不选为无限制，选中的采集源将限制用户只能访问这些源
              </p>
            </div>
          </div>

          <div className='mb-6'>
            <h4 className='mb-4 text-sm font-medium text-gray-700 dark:text-gray-300'>
              选择可用的采集源：
            </h4>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
              {config?.SourceConfig?.map((source) => (
                <label
                  key={source.key}
                  className='flex cursor-pointer items-center space-x-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                >
                  <input
                    type='checkbox'
                    checked={selectedApis.includes(source.key)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedApis([...selectedApis, source.key]);
                      } else {
                        setSelectedApis(
                          selectedApis.filter((api) => api !== source.key),
                        );
                      }
                    }}
                    className='rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {source.name}
                    </div>
                    {source.api && (
                      <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                        {extractDomain(source.api)}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className='mb-6 flex flex-wrap items-center justify-between rounded-lg bg-gray-50 p-4 dark:bg-gray-900'>
            <div className='flex space-x-2'>
              <button
                onClick={() => setSelectedApis([])}
                className={buttonStyles.quickAction}
              >
                全不选（无限制）
              </button>
              <button
                onClick={() => {
                  const allApis =
                    config?.SourceConfig?.filter(
                      (source) => !source.disabled,
                    ).map((s) => s.key) || [];
                  setSelectedApis(allApis);
                }}
                className={buttonStyles.quickAction}
              >
                全选
              </button>
            </div>
            <div className='text-sm text-gray-600 dark:text-gray-400'>
              已选择：
              <span className='font-medium text-blue-600 dark:text-blue-400'>
                {selectedApis.length > 0
                  ? `${selectedApis.length} 个源`
                  : '无限制'}
              </span>
            </div>
          </div>

          <div className='flex justify-end space-x-3'>
            <button
              onClick={closeConfigureApisModal}
              className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
            >
              取消
            </button>
            <button
              onClick={handleSaveUserApis}
              disabled={isLoading(`saveUserApis_${selectedUser?.username}`)}
              className={`px-6 py-2.5 text-sm font-medium ${
                isLoading(`saveUserApis_${selectedUser?.username}`)
                  ? buttonStyles.disabled
                  : buttonStyles.primary
              }`}
            >
              {isLoading(`saveUserApis_${selectedUser?.username}`)
                ? '配置中...'
                : '确认配置'}
            </button>
          </div>
        </AdminDialog>
      )}

      {/* 添加用户组弹窗 */}
      <AdminDialog
        isOpen={showAddUserGroupForm}
        title='添加新用户组'
        onClose={closeAddUserGroupModal}
        panelClassName='max-w-4xl max-h-[80vh] overflow-y-auto'
      >
        <div className='space-y-6'>
          {/* 用户组名称 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              用户组名称
            </label>
            <input
              type='text'
              placeholder='请输入用户组名称'
              value={newUserGroup.name}
              onChange={(e) =>
                setNewUserGroup((prev) => ({
                  ...prev,
                  name: e.target.value,
                }))
              }
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
            />
          </div>

          {/* 可用视频源 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
              可用视频源
            </label>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
              {config?.SourceConfig?.map((source) => (
                <label
                  key={source.key}
                  className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                >
                  <input
                    type='checkbox'
                    checked={newUserGroup.enabledApis.includes(source.key)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewUserGroup((prev) => ({
                          ...prev,
                          enabledApis: [...prev.enabledApis, source.key],
                        }));
                      } else {
                        setNewUserGroup((prev) => ({
                          ...prev,
                          enabledApis: prev.enabledApis.filter(
                            (api) => api !== source.key,
                          ),
                        }));
                      }
                    }}
                    className='rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                  />
                  <div className='flex-1 min-w-0'>
                    <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                      {source.name}
                    </div>
                    {source.api && (
                      <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                        {extractDomain(source.api)}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            {/* 快速操作按钮 */}
            <div className='mt-4 flex space-x-2'>
              <button
                onClick={() =>
                  setNewUserGroup((prev) => ({
                    ...prev,
                    enabledApis: [],
                  }))
                }
                className={buttonStyles.quickAction}
              >
                全不选（无限制）
              </button>
              <button
                onClick={() => {
                  const allApis =
                    config?.SourceConfig?.filter(
                      (source) => !source.disabled,
                    ).map((s) => s.key) || [];
                  setNewUserGroup((prev) => ({
                    ...prev,
                    enabledApis: allApis,
                  }));
                }}
                className={buttonStyles.quickAction}
              >
                全选
              </button>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className='flex justify-end space-x-3 border-t border-gray-200 pt-4 dark:border-gray-700'>
            <button
              onClick={closeAddUserGroupModal}
              className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
            >
              取消
            </button>
            <button
              onClick={handleAddUserGroup}
              disabled={
                !newUserGroup.name.trim() || isLoading('userGroup_add_new')
              }
              className={`px-6 py-2.5 text-sm font-medium ${
                !newUserGroup.name.trim() || isLoading('userGroup_add_new')
                  ? buttonStyles.disabled
                  : buttonStyles.primary
              }`}
            >
              {isLoading('userGroup_add_new') ? '添加中...' : '添加用户组'}
            </button>
          </div>
        </div>
      </AdminDialog>

      {/* 编辑用户组弹窗 */}
      {editingUserGroup && (
        <AdminDialog
          isOpen={showEditUserGroupForm}
          title={`编辑用户组 - ${editingUserGroup.name}`}
          onClose={closeEditUserGroupModal}
          panelClassName='max-w-4xl max-h-[80vh] overflow-y-auto'
        >
          <div className='space-y-6'>
            {/* 可用视频源 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                可用视频源
              </label>
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                {config?.SourceConfig?.map((source) => (
                  <label
                    key={source.key}
                    className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                  >
                    <input
                      type='checkbox'
                      checked={editingUserGroup.enabledApis.includes(
                        source.key,
                      )}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditingUserGroup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  enabledApis: [
                                    ...prev.enabledApis,
                                    source.key,
                                  ],
                                }
                              : null,
                          );
                        } else {
                          setEditingUserGroup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  enabledApis: prev.enabledApis.filter(
                                    (api) => api !== source.key,
                                  ),
                                }
                              : null,
                          );
                        }
                      }}
                      className='rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700'
                    />
                    <div className='flex-1 min-w-0'>
                      <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                        {source.name}
                      </div>
                      {source.api && (
                        <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                          {extractDomain(source.api)}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              {/* 快速操作按钮 */}
              <div className='mt-4 flex space-x-2'>
                <button
                  onClick={() =>
                    setEditingUserGroup((prev) =>
                      prev ? { ...prev, enabledApis: [] } : null,
                    )
                  }
                  className={buttonStyles.quickAction}
                >
                  全不选（无限制）
                </button>
                <button
                  onClick={() => {
                    const allApis =
                      config?.SourceConfig?.filter(
                        (source) => !source.disabled,
                      ).map((s) => s.key) || [];
                    setEditingUserGroup((prev) =>
                      prev ? { ...prev, enabledApis: allApis } : null,
                    );
                  }}
                  className={buttonStyles.quickAction}
                >
                  全选
                </button>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className='flex justify-end space-x-3 border-t border-gray-200 pt-4 dark:border-gray-700'>
              <button
                onClick={closeEditUserGroupModal}
                className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
              >
                取消
              </button>
              <button
                onClick={handleEditUserGroup}
                disabled={isLoading(`userGroup_edit_${editingUserGroup?.name}`)}
                className={`px-6 py-2.5 text-sm font-medium ${
                  isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                    ? buttonStyles.disabled
                    : buttonStyles.primary
                }`}
              >
                {isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                  ? '保存中...'
                  : '保存修改'}
              </button>
            </div>
          </div>
        </AdminDialog>
      )}

      {/* 配置用户组弹窗 */}
      {selectedUserForGroup && (
        <AdminDialog
          isOpen={showConfigureUserGroupModal}
          title={`配置用户组 - ${selectedUserForGroup.username}`}
          onClose={closeConfigureUserGroupModal}
          panelClassName='max-w-4xl max-h-[80vh] overflow-y-auto'
        >
          <div className='mb-6'>
            <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20'>
              <div className='mb-2 flex items-center space-x-2'>
                <svg
                  className='h-5 w-5 text-blue-600 dark:text-blue-400'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                  配置说明
                </span>
              </div>
              <p className='mt-1 text-sm text-blue-700 dark:text-blue-400'>
                提示：选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
              </p>
            </div>
          </div>

          <div className='mb-6'>
            <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              选择用户组：
            </label>
            <select
              value={selectedUserGroups.length > 0 ? selectedUserGroups[0] : ''}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedUserGroups(value ? [value] : []);
              }}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 transition-colors focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            >
              <option value=''>无用户组（无限制）</option>
              {userGroups.map((group) => (
                <option key={group.name} value={group.name}>
                  {group.name}{' '}
                  {group.enabledApis && group.enabledApis.length > 0
                    ? `(${group.enabledApis.length} 个源)`
                    : ''}
                </option>
              ))}
            </select>
            <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
              选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
            </p>
          </div>

          <div className='flex justify-end space-x-3'>
            <button
              onClick={closeConfigureUserGroupModal}
              className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
            >
              取消
            </button>
            <button
              onClick={handleSaveUserGroups}
              disabled={isLoading(
                `saveUserGroups_${selectedUserForGroup?.username}`,
              )}
              className={`px-6 py-2.5 text-sm font-medium ${
                isLoading(`saveUserGroups_${selectedUserForGroup?.username}`)
                  ? buttonStyles.disabled
                  : buttonStyles.primary
              }`}
            >
              {isLoading(`saveUserGroups_${selectedUserForGroup?.username}`)
                ? '配置中...'
                : '确认配置'}
            </button>
          </div>
        </AdminDialog>
      )}

      {/* 删除用户组确认弹窗 */}
      <ConfirmModal
        isOpen={showDeleteUserGroupModal && !!deletingUserGroup}
        title='确认删除用户组'
        onClose={() => {
          setShowDeleteUserGroupModal(false);
          setDeletingUserGroup(null);
        }}
        onConfirm={handleConfirmDeleteUserGroup}
        confirmDisabled={isLoading(
          `userGroup_delete_${deletingUserGroup?.name}`,
        )}
        confirmText={
          isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
            ? '删除中...'
            : '确认删除'
        }
        confirmClassName={`px-6 py-2.5 text-sm font-medium ${
          isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
            ? buttonStyles.disabled
            : buttonStyles.danger
        }`}
        cancelClassName={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
      >
        {deletingUserGroup && (
          <>
            <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
              <div className='flex items-center space-x-2 mb-2'>
                <svg
                  className='w-5 h-5 text-red-600 dark:text-red-400'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                  />
                </svg>
                <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                  危险操作警告
                </span>
              </div>
              <p className='text-sm text-red-700 dark:text-red-400'>
                删除用户组 <strong>{deletingUserGroup.name}</strong>{' '}
                将影响所有使用该组的用户，此操作不可恢复！
              </p>
            </div>

            {deletingUserGroup.affectedUsers.length > 0 ? (
              <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4'>
                <div className='flex items-center space-x-2 mb-2'>
                  <svg
                    className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    />
                  </svg>
                  <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                    ⚠️ 将影响 {deletingUserGroup.affectedUsers.length} 个用户：
                  </span>
                </div>
                <div className='space-y-1'>
                  {deletingUserGroup.affectedUsers.map((user, index) => (
                    <div
                      key={index}
                      className='text-sm text-yellow-700 dark:text-yellow-300'
                    >
                      • {user.username} ({user.role})
                    </div>
                  ))}
                </div>
                <p className='text-xs text-yellow-600 dark:text-yellow-400 mt-2'>
                  这些用户的用户组将被自动移除
                </p>
              </div>
            ) : (
              <div className='bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4'>
                <div className='flex items-center space-x-2'>
                  <svg
                    className='w-5 h-5 text-green-600 dark:text-green-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M5 13l4 4L19 7'
                    />
                  </svg>
                  <span className='text-sm font-medium text-green-800 dark:text-green-300'>
                    ✅ 当前没有用户使用此用户组
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </ConfirmModal>

      {/* 删除用户确认弹窗 */}
      <ConfirmModal
        isOpen={showDeleteUserModal && !!deletingUser}
        title='确认删除用户'
        onClose={() => {
          setShowDeleteUserModal(false);
          setDeletingUser(null);
        }}
        onConfirm={handleConfirmDeleteUser}
        confirmText='确认删除'
        confirmClassName={`px-6 py-2.5 text-sm font-medium ${buttonStyles.danger}`}
        cancelClassName={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
      >
        {deletingUser && (
          <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
            <div className='flex items-center space-x-2 mb-2'>
              <svg
                className='w-5 h-5 text-red-600 dark:text-red-400'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                />
              </svg>
              <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                危险操作警告
              </span>
            </div>
            <p className='text-sm text-red-700 dark:text-red-400'>
              删除用户 <strong>{deletingUser}</strong>{' '}
              将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！
            </p>
          </div>
        )}
      </ConfirmModal>

      {/* 批量设置用户组弹窗 */}
      <AdminDialog
        isOpen={showBatchUserGroupModal}
        title='批量设置用户组'
        onClose={closeBatchUserGroupModal}
        panelClassName='max-w-2xl'
      >
        <div className='mb-6'>
          <div className='mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20'>
            <div className='mb-2 flex items-center space-x-2'>
              <svg
                className='h-5 w-5 text-blue-600 dark:text-blue-400'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                />
              </svg>
              <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                批量操作说明
              </span>
            </div>
            <p className='text-sm text-blue-700 dark:text-blue-400'>
              将为选中的 <strong>{selectedUsers.size} 个用户</strong>{' '}
              设置用户组，选择"无用户组"为无限制
            </p>
          </div>

          <div>
            <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              选择用户组：
            </label>
            <select
              onChange={(e) => setSelectedUserGroup(e.target.value)}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 transition-colors focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              value={selectedUserGroup}
            >
              <option value=''>无用户组（无限制）</option>
              {userGroups.map((group) => (
                <option key={group.name} value={group.name}>
                  {group.name}{' '}
                  {group.enabledApis && group.enabledApis.length > 0
                    ? `(${group.enabledApis.length} 个源)`
                    : ''}
                </option>
              ))}
            </select>
            <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
              选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
            </p>
          </div>
        </div>

        <div className='flex justify-end space-x-3'>
          <button
            onClick={closeBatchUserGroupModal}
            className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
          >
            取消
          </button>
          <button
            onClick={() => handleBatchSetUserGroup(selectedUserGroup)}
            disabled={isLoading('batchSetUserGroup')}
            className={`px-6 py-2.5 text-sm font-medium ${
              isLoading('batchSetUserGroup')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('batchSetUserGroup') ? '设置中...' : '确认设置'}
          </button>
        </div>
      </AdminDialog>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

export default UserConfig;

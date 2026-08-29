'use client';

import { useCallback, useMemo, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { AddUserForm } from '@/features/admin/components/tabs/user-config/AddUserForm';
import { BatchUserGroupDialog } from '@/features/admin/components/tabs/user-config/BatchUserGroupDialog';
import { ChangePasswordForm } from '@/features/admin/components/tabs/user-config/ChangePasswordForm';
import { CleanupInactiveUsersDialog } from '@/features/admin/components/tabs/user-config/CleanupInactiveUsersDialog';
import { ConfigureUserApisDialog } from '@/features/admin/components/tabs/user-config/ConfigureUserApisDialog';
import { ConfigureUserGroupDialog } from '@/features/admin/components/tabs/user-config/ConfigureUserGroupDialog';
import { DeleteUserConfirm } from '@/features/admin/components/tabs/user-config/DeleteUserConfirm';
import { DeleteUserGroupConfirm } from '@/features/admin/components/tabs/user-config/DeleteUserGroupConfirm';
import { RegistrationSettingsDialog } from '@/features/admin/components/tabs/user-config/RegistrationSettingsDialog';
import { UserGroupFormDialog } from '@/features/admin/components/tabs/user-config/UserGroupFormDialog';
import { UserGroupTable } from '@/features/admin/components/tabs/user-config/UserGroupTable';
import { UserTable } from '@/features/admin/components/tabs/user-config/UserTable';
import { useAdminUserActions } from '@/features/admin/hooks/useAdminUserActions';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { useUserActivity } from '@/features/admin/hooks/useUserActivity';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { getSelectableUsers } from '@/features/admin/lib/permissions';
import { type InactiveCandidate } from '@/features/admin/services/inactiveUsers';
import {
  countActiveInviteCodes,
  CUSTOM_INVITE_CODE_RULE_MESSAGE,
  INVITE_MAX_USES_RULE_MESSAGE,
  isValidCustomInviteCode,
  parseInviteMaxUses,
} from '@/features/admin/services/inviteCodes';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useModalState } from '@/hooks/useModalState';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { AdminConfig } from '@/types/admin';

interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

type SensitiveUserAction = 'ban' | 'setAdmin' | 'cancelAdmin';

const DEFAULT_INACTIVE_DAYS = 90;
const DEFAULT_INVITE_VALID_DAYS = 7;

interface PendingSensitiveUserAction {
  action: SensitiveUserAction;
  username: string;
  title: string;
  message: string;
  confirmText: string;
}

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const { lastActiveAt, refreshActivity } = useUserActivity();
  const {
    userGroupAction,
    assignUserGroups,
    batchUpdateUserGroups,
    previewInactiveUsers,
    deleteInactiveUsers,
    createInviteCode,
    deleteInviteCode,
    setRequireInviteCode,
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
    userGroup: '',
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
  const [pendingSensitiveUserAction, setPendingSensitiveUserAction] =
    useState<PendingSensitiveUserAction | null>(null);
  const [showOpenRegisterConfirm, setShowOpenRegisterConfirm] = useState(false);
  const [showCleanupInactiveModal, setShowCleanupInactiveModal] =
    useModalState(false);
  const [inactiveDays, setInactiveDays] = useState(DEFAULT_INACTIVE_DAYS);
  const [includeNeverActive, setIncludeNeverActive] = useState(false);
  const [inactiveCandidates, setInactiveCandidates] = useState<
    InactiveCandidate[] | null
  >(null);
  const [showRegistrationModal, setShowRegistrationModal] =
    useModalState(false);
  const [inviteValidDays, setInviteValidDays] = useState(
    DEFAULT_INVITE_VALID_DAYS,
  );
  const [inviteCustomCode, setInviteCustomCode] = useState('');
  const [inviteMaxUses, setInviteMaxUses] = useState('');

  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;
  const permissionContext = useMemo(
    () => ({ role, currentUsername }),
    [role, currentUsername],
  );

  const selectableUsersCount = useMemo(
    () =>
      getSelectableUsers(config?.UserConfig?.Users || [], permissionContext)
        .length,
    [config?.UserConfig?.Users, permissionContext],
  );

  const inviteCodes = useMemo(
    () => config?.UserConfig?.InviteCodes || [],
    [config?.UserConfig?.InviteCodes],
  );

  const openRegister = !!config?.UserConfig?.OpenRegister;
  const requireInviteCode = !!config?.UserConfig?.RequireInviteCode;

  const registrationStatusText = useMemo(() => {
    if (!openRegister) return '已关闭';
    if (!requireInviteCode) return '已开启 · 无需邀请码';
    return `已开启 · ${countActiveInviteCodes(inviteCodes)} 个有效邀请码`;
  }, [openRegister, requireInviteCode, inviteCodes]);

  const selectAllUsers = useMemo(() => {
    return (
      selectedUsers.size === selectableUsersCount && selectedUsers.size > 0
    );
  }, [selectedUsers.size, selectableUsersCount]);

  const userGroups = config?.UserConfig?.Tags || [];

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
    } catch {
      // handled in handleUserGroupAction
    }
  };

  const handleStartEditUserGroup = (group: {
    name: string;
    enabledApis?: string[];
  }) => {
    setEditingUserGroup({
      name: group.name,
      enabledApis: group.enabledApis || [],
    });
    setShowEditUserGroupForm(true);
    setShowAddUserGroupForm(false);
  };

  const handleAssignUserGroup = async (
    username: string,
    nextUserGroups: string[],
  ) => {
    return withLoading(`assignUserGroup_${username}`, async () => {
      try {
        await assignUserGroups(username, nextUserGroups);
        showSuccess('用户组分配成功', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

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
      // handled in useAdminUserActions
    }
  };

  const handleBanUser = (username: string) => {
    setPendingSensitiveUserAction({
      action: 'ban',
      username,
      title: '确认封禁用户',
      message: `封禁后，用户「${username}」将无法登录。`,
      confirmText: '确认封禁',
    });
  };

  const handleUnbanUser = async (uname: string) => {
    await withLoading(`unbanUser_${uname}`, () =>
      handleUserAction('unban', uname),
    );
  };

  const updateOpenRegister = async (openRegister: boolean) => {
    await withLoading('setOpenRegister', async () => {
      try {
        await userAction(
          'setOpenRegister',
          undefined,
          undefined,
          undefined,
          openRegister,
        );
        showSuccess('开放注册设置已更新', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '更新失败', showAlert);
        throw err;
      }
    });
  };

  const handleToggleOpenRegister = () => {
    if (config?.UserConfig?.OpenRegister) {
      void updateOpenRegister(false);
      return;
    }
    setShowOpenRegisterConfirm(true);
  };

  const handleToggleRequireInviteCode = async () => {
    const next = !config?.UserConfig?.RequireInviteCode;
    await withLoading('setRequireInviteCode', async () => {
      try {
        await setRequireInviteCode(next);
        showSuccess(
          next ? '注册已要求邀请码' : '注册已不要求邀请码',
          showAlert,
        );
      } catch {
        // handled in setRequireInviteCode
      }
    });
  };

  const handleCreateInviteCode = async () => {
    const customCode = inviteCustomCode.trim();
    if (customCode && !isValidCustomInviteCode(customCode)) {
      showError(CUSTOM_INVITE_CODE_RULE_MESSAGE, showAlert);
      return;
    }

    const trimmedMaxUses = inviteMaxUses.trim();
    const maxUses = parseInviteMaxUses(
      trimmedMaxUses ? Number(trimmedMaxUses) : undefined,
    );
    if (maxUses === null) {
      showError(INVITE_MAX_USES_RULE_MESSAGE, showAlert);
      return;
    }

    await withLoading('createInviteCode', async () => {
      try {
        await createInviteCode(inviteValidDays, customCode, maxUses);
        setInviteCustomCode('');
        setInviteMaxUses('');
        showSuccess('邀请码已生成', showAlert);
      } catch {
        // handled in createInviteCode
      }
    });
  };

  const handleDeleteInviteCode = async (code: string) => {
    await withLoading(`deleteInviteCode_${code}`, async () => {
      try {
        await deleteInviteCode(code);
      } catch {
        // 邀请码可能已被其他管理员删除，拉一次最新列表
        await refreshConfig().catch(() => undefined);
      }
    });
  };

  const handleSetAdmin = (username: string) => {
    setPendingSensitiveUserAction({
      action: 'setAdmin',
      username,
      title: '确认设为管理员',
      message: `用户「${username}」将获得后台管理权限。`,
      confirmText: '确认授权',
    });
  };

  const handleRemoveAdmin = (username: string) => {
    setPendingSensitiveUserAction({
      action: 'cancelAdmin',
      username,
      title: '确认取消管理员',
      message: `用户「${username}」将失去后台管理权限。`,
      confirmText: '确认取消',
    });
  };

  const handleConfirmSensitiveUserAction = async () => {
    const pending = pendingSensitiveUserAction;
    if (!pending) return;
    const loadingKey =
      pending.action === 'cancelAdmin'
        ? `removeAdmin_${pending.username}`
        : `${pending.action}_${pending.username}`;
    setPendingSensitiveUserAction(null);
    await withLoading(loadingKey, () =>
      handleUserAction(pending.action, pending.username),
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
    setShowAddUserForm(false);
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
        } catch {
          // handled in handleAssignUserGroup
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

  const closeCleanupInactiveModal = () => {
    setShowCleanupInactiveModal(false);
    setInactiveCandidates(null);
    setIncludeNeverActive(false);
  };

  const handleSelectUser = useCallback((username: string, checked: boolean) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(username);
      } else {
        next.delete(username);
      }
      return next;
    });
  }, []);

  const handleSelectAllUsers = useCallback(
    (checked: boolean) => {
      if (checked) {
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
        await refreshConfig();
      } catch (err) {
        showError('批量设置用户组失败', showAlert);
        throw err;
      }
    });
  };

  const handleSaveUserApis = async () => {
    if (!selectedUser) return;

    await withLoading(`saveUserApis_${selectedUser.username}`, async () => {
      try {
        await updateUserApis(selectedUser.username, selectedApis);
        await refreshConfig();
        closeConfigureApisModal();
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleOpenCleanupInactive = () => {
    setInactiveCandidates(null);
    setIncludeNeverActive(false);
    setShowCleanupInactiveModal(true);
  };

  const handleScanInactiveUsers = async () => {
    await withLoading('scanInactiveUsers', async () => {
      try {
        setInactiveCandidates(
          await previewInactiveUsers(inactiveDays, includeNeverActive),
        );
      } catch {
        setInactiveCandidates(null);
      }
    });
  };

  const handleConfirmCleanupInactive = async () => {
    if (!inactiveCandidates || inactiveCandidates.length === 0) return;

    await withLoading('cleanupInactiveUsers', async () => {
      try {
        const result = await deleteInactiveUsers(
          inactiveDays,
          inactiveCandidates.map((candidate) => candidate.username),
          includeNeverActive,
        );
        await refreshActivity();
        setShowCleanupInactiveModal(false);
        setInactiveCandidates(null);
        setIncludeNeverActive(false);
        showSuccess(
          result.skippedCount > 0
            ? `已删除 ${result.deletedCount} 个用户，${result.skippedCount} 个因期间有活跃被跳过`
            : `已删除 ${result.deletedCount} 个用户`,
          showAlert,
        );
      } catch {
        // handled in deleteInactiveUsers
      }
    });
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;

    await withLoading(`deleteUser_${deletingUser}`, async () => {
      try {
        await handleUserAction('deleteUser', deletingUser);
        await refreshActivity();
        setShowDeleteUserModal(false);
        setDeletingUser(null);
      } catch {
        // handled in handleUserAction
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
      <div className='mb-1 grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <div>
          <h4 className='mb-3 text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户统计
          </h4>
          <div className='min-h-[96px] rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20'>
            <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
              {config.UserConfig.Users.length}
            </div>
            <div className='text-sm text-green-600 dark:text-green-400'>
              总用户数
            </div>
          </div>
        </div>
        <div>
          <h4 className='mb-3 text-sm font-medium text-gray-700 dark:text-gray-300'>
            注册设置
          </h4>
          <div className='flex min-h-[96px] items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
            <div>
              <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                开放注册
              </p>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                {registrationStatusText}
              </p>
            </div>
            <button
              type='button'
              onClick={() => setShowRegistrationModal(true)}
              className={buttonStyles.primary}
            >
              管理
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className='mb-3 flex items-center justify-between'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户组管理
          </h4>
          <button
            onClick={() => {
              setShowAddUserGroupForm(true);
              if (showEditUserGroupForm) {
                setShowEditUserGroupForm(false);
                setEditingUserGroup(null);
              }
            }}
            className={buttonStyles.primary}
          >
            添加用户组
          </button>
        </div>

        <UserGroupTable
          userGroups={userGroups}
          isEditLoading={(groupName) =>
            isLoading(`userGroup_edit_${groupName}`)
          }
          onEdit={handleStartEditUserGroup}
          onDelete={handleDeleteUserGroup}
        />
      </div>

      <div>
        <div className='mb-3 flex items-center justify-between'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户列表
          </h4>
          <div className='flex items-center space-x-2'>
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
                <div className='h-6 w-px bg-gray-300 dark:bg-gray-600'></div>
              </>
            )}
            <button
              onClick={() => {
                setShowAddUserForm(true);
                if (showChangePasswordForm) {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }
              }}
              className={buttonStyles.success}
            >
              添加用户
            </button>
            <button
              onClick={handleOpenCleanupInactive}
              className={buttonStyles.warning}
            >
              清理不活跃
            </button>
          </div>
        </div>

        <AddUserForm
          value={newUser}
          isOpen={showAddUserForm}
          onChange={setNewUser}
          userGroups={userGroups}
          onSubmit={handleAddUser}
          onCancel={() => {
            setShowAddUserForm(false);
            setNewUser({ username: '', password: '', userGroup: '' });
          }}
          isSubmitting={isLoading('addUser')}
        />

        <ChangePasswordForm
          username={changePasswordUser.username}
          password={changePasswordUser.password}
          isOpen={showChangePasswordForm}
          onPasswordChange={(next) =>
            setChangePasswordUser((prev) => ({ ...prev, password: next }))
          }
          onSubmit={handleChangePassword}
          onCancel={() => {
            setShowChangePasswordForm(false);
            setChangePasswordUser({ username: '', password: '' });
          }}
          isSubmitting={isLoading(
            `changePassword_${changePasswordUser.username}`,
          )}
        />

        <UserTable
          users={config.UserConfig.Users}
          lastActiveAt={lastActiveAt}
          currentUsername={currentUsername}
          permissionContext={permissionContext}
          selectableUsersCount={selectableUsersCount}
          selectedUsers={selectedUsers}
          selectAllUsers={selectAllUsers}
          isLoading={isLoading}
          onSelectAllUsers={handleSelectAllUsers}
          onSelectUser={handleSelectUser}
          onConfigureUserGroup={handleConfigureUserGroup}
          onConfigureUserApis={handleConfigureUserApis}
          onShowChangePassword={handleShowChangePasswordForm}
          onSetAdmin={handleSetAdmin}
          onRemoveAdmin={handleRemoveAdmin}
          onBanUser={handleBanUser}
          onUnbanUser={handleUnbanUser}
          onDeleteUser={handleDeleteUser}
        />
      </div>

      {selectedUser && (
        <ConfigureUserApisDialog
          isOpen={showConfigureApisModal}
          username={selectedUser.username}
          sources={config.SourceConfig || []}
          selectedApis={selectedApis}
          onSelectedApisChange={setSelectedApis}
          onClose={closeConfigureApisModal}
          onSave={handleSaveUserApis}
          isSaving={isLoading(`saveUserApis_${selectedUser.username}`)}
        />
      )}

      <UserGroupFormDialog
        mode='add'
        isOpen={showAddUserGroupForm}
        value={newUserGroup}
        onChange={setNewUserGroup}
        sources={config.SourceConfig || []}
        onClose={closeAddUserGroupModal}
        onSubmit={handleAddUserGroup}
        isSubmitting={isLoading('userGroup_add_new')}
      />

      {editingUserGroup && (
        <UserGroupFormDialog
          mode='edit'
          isOpen={showEditUserGroupForm}
          value={editingUserGroup}
          onChange={(next) =>
            setEditingUserGroup({
              name: editingUserGroup.name,
              enabledApis: next.enabledApis,
            })
          }
          sources={config.SourceConfig || []}
          onClose={closeEditUserGroupModal}
          onSubmit={handleEditUserGroup}
          isSubmitting={isLoading(`userGroup_edit_${editingUserGroup.name}`)}
        />
      )}

      {selectedUserForGroup && (
        <ConfigureUserGroupDialog
          isOpen={showConfigureUserGroupModal}
          username={selectedUserForGroup.username}
          selectedGroup={
            selectedUserGroups.length > 0 ? selectedUserGroups[0] : ''
          }
          userGroups={userGroups}
          onSelectedGroupChange={(next) =>
            setSelectedUserGroups(next ? [next] : [])
          }
          onClose={closeConfigureUserGroupModal}
          onSave={handleSaveUserGroups}
          isSaving={isLoading(
            `saveUserGroups_${selectedUserForGroup.username}`,
          )}
        />
      )}

      <DeleteUserGroupConfirm
        isOpen={showDeleteUserGroupModal && !!deletingUserGroup}
        groupName={deletingUserGroup?.name || ''}
        affectedUsers={deletingUserGroup?.affectedUsers || []}
        onCancel={() => {
          setShowDeleteUserGroupModal(false);
          setDeletingUserGroup(null);
        }}
        onConfirm={handleConfirmDeleteUserGroup}
        isDeleting={isLoading(`userGroup_delete_${deletingUserGroup?.name}`)}
      />

      <DeleteUserConfirm
        isOpen={showDeleteUserModal && !!deletingUser}
        username={deletingUser || ''}
        onCancel={() => {
          setShowDeleteUserModal(false);
          setDeletingUser(null);
        }}
        onConfirm={handleConfirmDeleteUser}
      />

      <BatchUserGroupDialog
        isOpen={showBatchUserGroupModal}
        selectedUserCount={selectedUsers.size}
        selectedGroup={selectedUserGroup}
        userGroups={userGroups}
        onSelectedGroupChange={setSelectedUserGroup}
        onClose={closeBatchUserGroupModal}
        onConfirm={() => handleBatchSetUserGroup(selectedUserGroup)}
        isSaving={isLoading('batchSetUserGroup')}
      />

      <CleanupInactiveUsersDialog
        isOpen={showCleanupInactiveModal}
        inactiveDays={inactiveDays}
        candidates={inactiveCandidates}
        isScanning={isLoading('scanInactiveUsers')}
        isDeleting={isLoading('cleanupInactiveUsers')}
        includeNeverActive={includeNeverActive}
        onIncludeNeverActiveChange={(next) => {
          setIncludeNeverActive(next);
          setInactiveCandidates(null);
        }}
        onInactiveDaysChange={(next) => {
          setInactiveDays(next);
          setInactiveCandidates(null);
        }}
        onScan={handleScanInactiveUsers}
        onConfirm={handleConfirmCleanupInactive}
        onClose={closeCleanupInactiveModal}
      />

      <RegistrationSettingsDialog
        isOpen={showRegistrationModal}
        openRegister={!!config.UserConfig.OpenRegister}
        requireInviteCode={!!config.UserConfig.RequireInviteCode}
        inviteCodes={inviteCodes}
        validDays={inviteValidDays}
        customCode={inviteCustomCode}
        maxUses={inviteMaxUses}
        isTogglingRegister={isLoading('setOpenRegister')}
        isTogglingInvite={isLoading('setRequireInviteCode')}
        isCreatingCode={isLoading('createInviteCode')}
        deletingCode={
          inviteCodes.find((item) => isLoading(`deleteInviteCode_${item.code}`))
            ?.code || null
        }
        onToggleOpenRegister={handleToggleOpenRegister}
        onToggleRequireInviteCode={handleToggleRequireInviteCode}
        onValidDaysChange={setInviteValidDays}
        onCustomCodeChange={setInviteCustomCode}
        onMaxUsesChange={setInviteMaxUses}
        onCreateCode={handleCreateInviteCode}
        onDeleteCode={handleDeleteInviteCode}
        onClose={() => setShowRegistrationModal(false)}
      />

      <ConfirmModal
        isOpen={pendingSensitiveUserAction !== null}
        title={pendingSensitiveUserAction?.title || '确认操作'}
        message={pendingSensitiveUserAction?.message}
        onClose={() => setPendingSensitiveUserAction(null)}
        onConfirm={() => void handleConfirmSensitiveUserAction()}
        confirmText={pendingSensitiveUserAction?.confirmText}
        danger={pendingSensitiveUserAction?.action === 'ban'}
      />

      <ConfirmModal
        isOpen={showOpenRegisterConfirm}
        title='确认开放注册'
        message='开启后，未注册用户可以通过注册接口自行创建账号。'
        onClose={() => setShowOpenRegisterConfirm(false)}
        onConfirm={() => {
          setShowOpenRegisterConfirm(false);
          void updateOpenRegister(true);
        }}
        confirmText='确认开启'
      />

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

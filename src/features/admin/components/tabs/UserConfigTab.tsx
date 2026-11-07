'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import Select from '@/components/Select';
import { AdminUserRowsSkeleton } from '@/features/admin/components/AdminContentSkeleton';
import AdminSearchField from '@/features/admin/components/AdminSearchField';
import { AddUserForm } from '@/features/admin/components/tabs/user-config/AddUserForm';
import { BatchUserGroupDialog } from '@/features/admin/components/tabs/user-config/BatchUserGroupDialog';
import { ChangePasswordForm } from '@/features/admin/components/tabs/user-config/ChangePasswordForm';
import { CleanupInactiveUsersDialog } from '@/features/admin/components/tabs/user-config/CleanupInactiveUsersDialog';
import { ConfigureUserApisDialog } from '@/features/admin/components/tabs/user-config/ConfigureUserApisDialog';
import { ConfigureUserGroupDialog } from '@/features/admin/components/tabs/user-config/ConfigureUserGroupDialog';
import { DeleteUserConfirm } from '@/features/admin/components/tabs/user-config/DeleteUserConfirm';
import { DeleteUserGroupConfirm } from '@/features/admin/components/tabs/user-config/DeleteUserGroupConfirm';
import { RegistrationSettingsDialog } from '@/features/admin/components/tabs/user-config/RegistrationSettingsDialog';
import { RegistrationSummaryCard } from '@/features/admin/components/tabs/user-config/RegistrationSummaryCard';
import {
  type UserGroupDraft,
  EMPTY_USER_GROUP_DRAFT,
  UserGroupFormDialog,
} from '@/features/admin/components/tabs/user-config/UserGroupFormDialog';
import { UserGroupTable } from '@/features/admin/components/tabs/user-config/UserGroupTable';
import { UserTable } from '@/features/admin/components/tabs/user-config/UserTable';
import { useAdminInviteCodes } from '@/features/admin/hooks/useAdminInviteCodes';
import {
  type InviteCodeDraft,
  useAdminUserActions,
} from '@/features/admin/hooks/useAdminUserActions';
import { useAdminUsers } from '@/features/admin/hooks/useAdminUsers';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { adminGet, adminPost } from '@/features/admin/lib/api';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { getSelectableUsers } from '@/features/admin/lib/permissions';
import {
  type AdminUserFilter,
  type AdminUserPage,
  type AdminUserQuery,
  type AdminUserSelection,
} from '@/features/admin/lib/user-query';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useModalState } from '@/hooks/useModalState';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import type { InviteCodeFilter } from '@/lib/invite-code-storage';
import { AdminConfig } from '@/types/admin';

interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

type SensitiveUserAction = 'ban' | 'setAdmin' | 'cancelAdmin';

const DEFAULT_INACTIVE_DAYS = 90;

interface PendingSensitiveUserAction {
  action: SensitiveUserAction;
  username: string;
  title: string;
  message: string;
  confirmText: string;
}

const SELECTION_LINK_CLASS =
  'font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300';

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] =
    useState<AdminUserFilter['filter']>('all');
  const [userGroupFilter, setUserGroupFilter] = useState('');
  const [userSort, setUserSort] = useState<AdminUserQuery['sort']>('priority');
  const userList = useAdminUsers({
    q: userSearch,
    filter: userFilter,
    group: userGroupFilter,
    sort: userSort,
  });
  const refreshUsersAndConfig = async () => {
    setSelectedUsers(new Set());
    setAllMatching(false);
    setExcludedUsers(new Set());
    setBatchPreview(null);
    await Promise.all([refreshConfig(), userList.refresh()]);
  };
  const lastActiveAt = Object.fromEntries(
    userList.items.map((user) => [user.username, user.lastActiveAt || 0]),
  );
  const [allMatching, setAllMatching] = useState(false);
  const [excludedUsers, setExcludedUsers] = useState<Set<string>>(new Set());
  const [batchPreview, setBatchPreview] = useState<{
    affectedCount: number;
    skippedCount: number;
    selection: AdminUserSelection;
    group: string;
  } | null>(null);
  const {
    userGroupAction,
    assignUserGroups,
    previewInactiveUsers,
    deleteInactiveUsers,
    createInviteCodes,
    deleteInviteCode,
    setRequireInviteCode,
    updateUserApis,
    userAction,
  } = useAdminUserActions({
    refreshConfig: refreshUsersAndConfig,
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
  const [newUserGroup, setNewUserGroup] = useState<UserGroupDraft>(
    EMPTY_USER_GROUP_DRAFT,
  );
  const [editingUserGroup, setEditingUserGroup] =
    useState<UserGroupDraft | null>(null);
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
  const retainedUser = useRetainedValue(selectedUser);
  const retainedUserForGroup = useRetainedValue(selectedUserForGroup);
  const retainedEditingGroup = useRetainedValue(editingUserGroup);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showBatchUserGroupModal, setShowBatchUserGroupModal] =
    useModalState(false);
  const [selectedUserGroup, setSelectedUserGroup] = useState<string>('');
  const [showDeleteUserGroupModal, setShowDeleteUserGroupModal] =
    useModalState(false);
  const [deletingUserGroup, setDeletingUserGroup] = useState<{
    name: string;
    affectedCount: number;
  } | null>(null);
  const [showDeleteUserModal, setShowDeleteUserModal] = useModalState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [pendingSensitiveUserAction, setPendingSensitiveUserAction] =
    useState<PendingSensitiveUserAction | null>(null);
  const [showOpenRegisterConfirm, setShowOpenRegisterConfirm] = useState(false);
  const [showCleanupInactiveModal, setShowCleanupInactiveModal] =
    useModalState(false);
  const [inactiveDays, setInactiveDays] = useState(DEFAULT_INACTIVE_DAYS);
  const [inactiveCandidates, setInactiveCandidates] = useState<{
    count: number;
    confirmation: string;
  } | null>(null);
  const [showRegistrationModal, setShowRegistrationModal] =
    useModalState(false);
  const [inviteFilter, setInviteFilter] = useState<InviteCodeFilter>('all');

  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;
  const permissionContext = useMemo(
    () => ({ role, currentUsername }),
    [role, currentUsername],
  );

  const visibleUsers = userList.items;
  useEffect(() => {
    setSelectedUsers(new Set());
    setAllMatching(false);
    setExcludedUsers(new Set());
    setBatchPreview(null);
  }, [userSearch, userFilter, userGroupFilter, userSort]);
  const selectedCount = allMatching
    ? Math.max(0, userList.total - excludedUsers.size)
    : selectedUsers.size;
  const displayedSelection = allMatching
    ? new Set(
        visibleUsers
          .filter((user) => !excludedUsers.has(user.username))
          .map((user) => user.username),
      )
    : selectedUsers;

  const selectableVisibleUsers = useMemo(
    () =>
      getSelectableUsers(visibleUsers, permissionContext).filter(
        (user) => user.username !== currentUsername && user.role !== 'owner',
      ),
    [visibleUsers, permissionContext, currentUsername],
  );

  const inviteList = useAdminInviteCodes(inviteFilter, showRegistrationModal);
  const activeInviteCodeCount = config?.UserConfig?.activeInviteCodeCount ?? 0;

  const openRegister = !!config?.UserConfig?.OpenRegister;
  const requireInviteCode = !!config?.UserConfig?.RequireInviteCode;

  const selectAllUsers =
    selectableVisibleUsers.length > 0 &&
    selectableVisibleUsers.every((user) =>
      displayedSelection.has(user.username),
    );

  const userGroups = config?.UserConfig?.Tags || [];
  const isLiveGrantedByGroup =
    config?.SiteConfig?.EnableLiveEntry === true &&
    config.SiteConfig.LiveAccess === 'groups';

  const handleUserGroupAction = async (
    action: 'add' | 'edit' | 'delete',
    groupName: string,
    draft?: UserGroupDraft,
  ) => {
    return withLoading(`userGroup_${action}_${groupName}`, async () => {
      try {
        await userGroupAction(action, groupName, draft);

        if (action === 'add') {
          setNewUserGroup(EMPTY_USER_GROUP_DRAFT);
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
        );
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleAddUserGroup = () => {
    if (!newUserGroup.name.trim()) return;
    handleUserGroupAction('add', newUserGroup.name, newUserGroup);
  };

  const handleEditUserGroup = () => {
    if (!editingUserGroup?.name.trim()) return;
    handleUserGroupAction('edit', editingUserGroup.name, editingUserGroup);
  };

  const handleDeleteUserGroup = async (groupName: string) => {
    try {
      const page = await adminGet<AdminUserPage>(
        `/api/admin/user?${new URLSearchParams({ group: groupName, limit: '1' })}`,
      );
      setDeletingUserGroup({ name: groupName, affectedCount: page.total });
      setShowDeleteUserGroupModal(true);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : '获取用户组人数失败',
        showAlert,
      );
    }
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
    allowLive?: boolean;
  }) => {
    setEditingUserGroup({
      name: group.name,
      enabledApis: group.enabledApis || [],
      allowLive: group.allowLive === true,
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
        showSuccess('用户组分配成功');
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
        showSuccess('开放注册设置已更新');
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
        showSuccess(next ? '注册已要求邀请码' : '注册已不要求邀请码');
      } catch {
        // handled in setRequireInviteCode
      }
    });
  };

  const handleCreateInviteCodes = (draft: InviteCodeDraft) =>
    withLoading('createInviteCode', async () => {
      try {
        const codes = await createInviteCodes(draft);
        void inviteList.refresh();
        return codes;
      } catch {
        // handled in createInviteCodes
        return null;
      }
    });

  const handleDeleteInviteCode = async (code: string) => {
    await withLoading(`deleteInviteCode_${code}`, async () => {
      try {
        await deleteInviteCode(code);
      } catch {
        // 邀请码可能已被其他管理员删除，拉一次最新摘要
        await refreshConfig().catch(() => undefined);
      }
      void inviteList.refresh();
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
  };

  const handleSelectUser = useCallback(
    (username: string, checked: boolean) => {
      if (allMatching) {
        setExcludedUsers((previous) => {
          const next = new Set(previous);
          if (checked) next.delete(username);
          else next.add(username);
          return next;
        });
        return;
      }
      setSelectedUsers((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(username);
        } else {
          next.delete(username);
        }
        return next;
      });
    },
    [allMatching],
  );

  const handleSelectAllUsers = useCallback(
    (checked: boolean) => {
      setAllMatching(false);
      setExcludedUsers(new Set());
      setSelectedUsers((previous) => {
        const next = new Set(previous);
        selectableVisibleUsers.forEach(({ username }) => {
          if (checked) next.add(username);
          else next.delete(username);
        });
        return next;
      });
    },
    [selectableVisibleUsers],
  );

  const handleBatchSetUserGroup = async (userGroup: string) => {
    if (!selectedCount) return;
    const selection: AdminUserSelection = allMatching
      ? {
          mode: 'all',
          filter: { q: userSearch, filter: userFilter, group: userGroupFilter },
          excluded: [...excludedUsers],
        }
      : { mode: 'explicit', usernames: [...selectedUsers] };
    await withLoading('batchSetUserGroup', async () => {
      try {
        const result = await adminPost<{
          affectedCount: number;
          skippedCount: number;
        }>('/api/admin/user', {
          action: 'batchUpdateUserGroups',
          selection,
          userGroups: userGroup ? [userGroup] : [],
          dryRun: true,
        });
        setBatchPreview({ ...result, selection, group: userGroup });
        closeBatchUserGroupModal();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '预估操作人数失败',
          showAlert,
        );
      }
    });
  };

  const confirmBatch = async () => {
    if (!batchPreview) return;
    await withLoading('batchSetUserGroup', async () => {
      try {
        const result = await adminPost<{
          processedCount: number;
          skippedCount: number;
        }>('/api/admin/user', {
          action: 'batchUpdateUserGroups',
          selection: batchPreview.selection,
          userGroups: batchPreview.group ? [batchPreview.group] : [],
        });
        setBatchPreview(null);
        setSelectedUsers(new Set());
        setAllMatching(false);
        setExcludedUsers(new Set());
        await refreshUsersAndConfig();
        showSuccess(
          `已处理 ${result.processedCount} 个用户，跳过 ${result.skippedCount} 个`,
        );
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '批量设置用户组失败',
          showAlert,
        );
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
    setShowCleanupInactiveModal(true);
  };

  const handleScanInactiveUsers = async () => {
    await withLoading('scanInactiveUsers', async () => {
      try {
        setInactiveCandidates(await previewInactiveUsers(inactiveDays));
      } catch {
        setInactiveCandidates(null);
      }
    });
  };

  const handleConfirmCleanupInactive = async () => {
    if (!inactiveCandidates || inactiveCandidates.count === 0) return;

    await withLoading('cleanupInactiveUsers', async () => {
      try {
        const result = await deleteInactiveUsers(
          inactiveDays,
          inactiveCandidates.confirmation,
        );
        await userList.refresh();
        setShowCleanupInactiveModal(false);
        setInactiveCandidates(null);
        showSuccess(
          result.skippedCount > 0
            ? `已删除 ${result.deletedCount} 个用户，${result.skippedCount} 个因期间有活跃被跳过`
            : `已删除 ${result.deletedCount} 个用户`,
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
        await userList.refresh();
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
      <RegistrationSummaryCard
        openRegister={openRegister}
        requireInviteCode={requireInviteCode}
        activeInviteCodeCount={activeInviteCodeCount}
        onManage={() => setShowRegistrationModal(true)}
      />

      <div>
        <h2 className='mb-3 text-base font-semibold text-gray-900 dark:text-gray-100'>
          用户列表
        </h2>
        <div className='mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <AdminSearchField
              value={userSearch}
              onChange={setUserSearch}
              label='搜索用户名或昵称'
              className='w-full sm:w-64'
            />
            <Select
              value={userFilter || 'all'}
              onChange={(value) =>
                setUserFilter(value as AdminUserFilter['filter'])
              }
              ariaLabel='筛选用户角色或状态'
              variant='pill'
              className='shrink-0'
              options={[
                { value: 'all', label: '全部' },
                { value: 'owner', label: '站长' },
                { value: 'admin', label: '管理员' },
                { value: 'user', label: '普通用户' },
                { value: 'banned', label: '已封禁' },
              ]}
            />
            {(userGroups.length > 0 || userGroupFilter) && (
              <Select
                value={userGroupFilter}
                onChange={setUserGroupFilter}
                ariaLabel='筛选用户组'
                variant='pill'
                className='shrink-0'
                options={[
                  { value: '', label: '全部用户组' },
                  ...userGroups.map((group) => ({
                    value: group.name,
                    label: group.name,
                  })),
                ]}
              />
            )}
            <Select
              value={userSort || 'priority'}
              onChange={(value) => setUserSort(value as AdminUserQuery['sort'])}
              ariaLabel='用户排序'
              variant='pill'
              className='shrink-0'
              options={[
                { value: 'priority', label: '默认排序' },
                { value: 'username', label: '用户名' },
                { value: 'activeDesc', label: '最近活跃' },
                { value: 'activeAsc', label: '最久未活跃' },
              ]}
            />
          </div>
          <div className='flex shrink-0 flex-wrap items-center gap-2'>
            <button
              onClick={handleOpenCleanupInactive}
              className={buttonStyles.outline}
            >
              清理不活跃
            </button>
            <button
              onClick={() => {
                setShowAddUserForm(true);
                if (showChangePasswordForm) {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }
              }}
              className={buttonStyles.primary}
            >
              添加用户
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

        {(allMatching || (selectAllUsers && userList.nextCursor)) && (
          <div className='mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-brand-50 px-3 py-2 text-sm text-gray-700 dark:bg-brand-500/10 dark:text-gray-300'>
            {allMatching ? (
              <>
                <span>已选择全部 {selectedCount} 个匹配用户</span>
                <button
                  type='button'
                  className={SELECTION_LINK_CLASS}
                  onClick={() => handleSelectAllUsers(false)}
                >
                  清除选择
                </button>
              </>
            ) : (
              <>
                <span>已选择已加载的 {selectedUsers.size} 个用户</span>
                <button
                  type='button'
                  className={SELECTION_LINK_CLASS}
                  onClick={() => {
                    setAllMatching(true);
                    setExcludedUsers(new Set());
                  }}
                >
                  选择全部 {userList.total} 个匹配用户
                </button>
              </>
            )}
          </div>
        )}
        {userList.error && (
          <p role='alert' className='mb-3 text-sm text-red-600'>
            {userList.error}{' '}
            <button
              type='button'
              className={buttonStyles.quickAction}
              onClick={() => void userList.refresh()}
            >
              重试
            </button>
          </p>
        )}
        {userList.loading && visibleUsers.length === 0 ? (
          <AdminUserRowsSkeleton
            count={Math.min(config.UserConfig.TotalUsers ?? 50, 50)}
          />
        ) : (
          <UserTable
            total={userList.total}
            selectedCount={selectedCount}
            users={visibleUsers}
            lastActiveAt={lastActiveAt}
            currentUsername={currentUsername}
            permissionContext={permissionContext}
            selectableUsersCount={selectableVisibleUsers.length}
            selectedUsers={displayedSelection}
            selectAllUsers={selectAllUsers}
            isLoading={isLoading}
            onBatchUserGroup={() => setShowBatchUserGroupModal(true)}
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
        )}
        {userList.nextCursor && (
          <div className='mt-4 flex justify-center'>
            <button
              type='button'
              disabled={userList.loading}
              onClick={() => void userList.loadMore()}
              className={buttonStyles.outline}
            >
              {userList.loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      <div>
        <div className='mb-3 flex items-center justify-between'>
          <h2 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
            用户组
          </h2>
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
          showLiveAccess={isLiveGrantedByGroup}
          isEditLoading={(groupName) =>
            isLoading(`userGroup_edit_${groupName}`)
          }
          onEdit={handleStartEditUserGroup}
          onDelete={handleDeleteUserGroup}
        />
      </div>

      <ConfigureUserApisDialog
        isOpen={showConfigureApisModal && Boolean(selectedUser)}
        username={retainedUser?.username ?? ''}
        sources={config.SourceConfig || []}
        selectedApis={selectedApis}
        onSelectedApisChange={setSelectedApis}
        onClose={closeConfigureApisModal}
        onSave={handleSaveUserApis}
        isSaving={isLoading(`saveUserApis_${retainedUser?.username}`)}
      />

      <UserGroupFormDialog
        mode='add'
        isOpen={showAddUserGroupForm}
        value={newUserGroup}
        onChange={setNewUserGroup}
        sources={config.SourceConfig || []}
        showLiveAccess={isLiveGrantedByGroup}
        onClose={closeAddUserGroupModal}
        onSubmit={handleAddUserGroup}
        isSubmitting={isLoading('userGroup_add_new')}
      />

      <UserGroupFormDialog
        mode='edit'
        isOpen={showEditUserGroupForm && Boolean(editingUserGroup)}
        value={retainedEditingGroup ?? EMPTY_USER_GROUP_DRAFT}
        onChange={(next) =>
          setEditingUserGroup((current) =>
            current
              ? {
                  ...current,
                  enabledApis: next.enabledApis,
                  allowLive: next.allowLive,
                }
              : current,
          )
        }
        sources={config.SourceConfig || []}
        showLiveAccess={isLiveGrantedByGroup}
        onClose={closeEditUserGroupModal}
        onSubmit={handleEditUserGroup}
        isSubmitting={isLoading(`userGroup_edit_${retainedEditingGroup?.name}`)}
      />

      <ConfigureUserGroupDialog
        isOpen={showConfigureUserGroupModal && Boolean(selectedUserForGroup)}
        username={retainedUserForGroup?.username ?? ''}
        selectedGroup={
          selectedUserGroups.length > 0 ? selectedUserGroups[0] : ''
        }
        userGroups={userGroups}
        onSelectedGroupChange={(next) =>
          setSelectedUserGroups(next ? [next] : [])
        }
        onClose={closeConfigureUserGroupModal}
        onSave={handleSaveUserGroups}
        isSaving={isLoading(`saveUserGroups_${retainedUserForGroup?.username}`)}
      />

      <DeleteUserGroupConfirm
        isOpen={showDeleteUserGroupModal && !!deletingUserGroup}
        groupName={deletingUserGroup?.name || ''}
        affectedCount={deletingUserGroup?.affectedCount || 0}
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
        selectedGroup={selectedUserGroup}
        userGroups={userGroups}
        onSelectedGroupChange={setSelectedUserGroup}
        onClose={closeBatchUserGroupModal}
        onConfirm={() => handleBatchSetUserGroup(selectedUserGroup)}
        isSaving={isLoading('batchSetUserGroup')}
      />

      <ConfirmModal
        isOpen={!!batchPreview}
        title='确认批量设置用户组'
        message={`预计处理 ${batchPreview?.affectedCount || 0} 个用户，跳过 ${batchPreview?.skippedCount || 0} 个。`}
        onClose={() => setBatchPreview(null)}
        onConfirm={() => void confirmBatch()}
        confirmDisabled={
          isLoading('batchSetUserGroup') || !batchPreview?.affectedCount
        }
      />
      <CleanupInactiveUsersDialog
        isOpen={showCleanupInactiveModal}
        inactiveDays={inactiveDays}
        candidates={inactiveCandidates}
        isScanning={isLoading('scanInactiveUsers')}
        isDeleting={isLoading('cleanupInactiveUsers')}
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
        inviteFilter={inviteFilter}
        inviteList={inviteList}
        isTogglingRegister={isLoading('setOpenRegister')}
        isTogglingInvite={isLoading('setRequireInviteCode')}
        isCreatingCode={isLoading('createInviteCode')}
        deletingCode={
          inviteList.items.find((item) =>
            isLoading(`deleteInviteCode_${item.code}`),
          )?.code || null
        }
        onToggleOpenRegister={handleToggleOpenRegister}
        onToggleRequireInviteCode={handleToggleRequireInviteCode}
        onInviteFilterChange={setInviteFilter}
        onCreateCodes={handleCreateInviteCodes}
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

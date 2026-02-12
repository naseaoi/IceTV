'use client';

import { useCallback } from 'react';

import { adminPost } from '@/features/admin/lib/api';
import { type ShowAlertFn } from '@/features/admin/hooks/useAlertModal';
import { showError } from '@/features/admin/lib/notifications';

type UserAction =
  | 'add'
  | 'ban'
  | 'unban'
  | 'setAdmin'
  | 'cancelAdmin'
  | 'changePassword'
  | 'deleteUser';

interface UseAdminUserActionsOptions {
  refreshConfig: () => Promise<void>;
  showAlert: ShowAlertFn;
}

export function useAdminUserActions(options: UseAdminUserActionsOptions) {
  const { refreshConfig, showAlert } = options;

  const runUserMutation = useCallback(
    async (payload: Record<string, unknown>, fallbackPrefix = '操作失败') => {
      try {
        await adminPost('/api/admin/user', payload, fallbackPrefix);
        await refreshConfig();
      } catch (err) {
        showError(
          err instanceof Error ? err.message : fallbackPrefix,
          showAlert,
        );
        throw err;
      }
    },
    [refreshConfig, showAlert],
  );

  const userGroupAction = useCallback(
    async (
      action: 'add' | 'edit' | 'delete',
      groupName: string,
      enabledApis?: string[],
    ) => {
      await runUserMutation({
        action: 'userGroup',
        groupAction: action,
        groupName,
        enabledApis,
      });
    },
    [runUserMutation],
  );

  const assignUserGroups = useCallback(
    async (username: string, userGroups: string[]) => {
      await runUserMutation({
        targetUsername: username,
        action: 'updateUserGroups',
        userGroups,
      });
    },
    [runUserMutation],
  );

  const batchUpdateUserGroups = useCallback(
    async (usernames: string[], userGroup: string) => {
      await runUserMutation({
        action: 'batchUpdateUserGroups',
        usernames,
        userGroups: userGroup === '' ? [] : [userGroup],
      });
    },
    [runUserMutation],
  );

  const updateUserApis = useCallback(
    async (username: string, enabledApis: string[]) => {
      await runUserMutation({
        targetUsername: username,
        action: 'updateUserApis',
        enabledApis,
      });
    },
    [runUserMutation],
  );

  const userAction = useCallback(
    async (
      action: UserAction,
      targetUsername: string,
      targetPassword?: string,
      userGroup?: string,
    ) => {
      await runUserMutation({
        targetUsername,
        ...(targetPassword ? { targetPassword } : {}),
        ...(userGroup ? { userGroup } : {}),
        action,
      });
    },
    [runUserMutation],
  );

  return {
    userGroupAction,
    assignUserGroups,
    batchUpdateUserGroups,
    updateUserApis,
    userAction,
  };
}

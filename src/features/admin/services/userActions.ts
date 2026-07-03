import { ConfigConflictError, getConfig, saveConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { assertValidUsername, normalizeUsername } from '@/lib/username';

const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'changePassword',
  'deleteUser',
  'updateUserApis',
  'userGroup',
  'updateUserGroups',
  'batchUpdateUserGroups',
  'setOpenRegister',
] as const;

type AdminUserActionResponse = {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
};

type AdminUserActionContext = {
  body: unknown;
  operatorUsername: string;
  operatorRole: 'owner' | 'admin';
};

function actionResponse(
  body: unknown,
  status?: number,
  headers?: Record<string, string>,
): AdminUserActionResponse {
  return { body, status, headers };
}

function toActionResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): AdminUserActionResponse {
  return actionResponse(body, init?.status, init?.headers);
}

export async function handleAdminUserAction({
  body,
  operatorUsername,
  operatorRole,
}: AdminUserActionContext): Promise<AdminUserActionResponse> {
  const username = normalizeUsername(operatorUsername);

  try {
    const {
      targetUsername: rawTargetUsername,
      targetPassword,
      action,
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      action?: (typeof ACTIONS)[number];
    };
    const targetUsername =
      typeof rawTargetUsername === 'string'
        ? normalizeUsername(rawTargetUsername)
        : undefined;

    if (!action || !ACTIONS.includes(action)) {
      return actionResponse({ error: '参数格式错误' }, 400);
    }

    if (
      !targetUsername &&
      !['userGroup', 'batchUpdateUserGroups', 'setOpenRegister'].includes(
        action,
      )
    ) {
      return actionResponse({ error: '缺少目标用户名' }, 400);
    }

    if (
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      action !== 'updateUserApis' &&
      action !== 'userGroup' &&
      action !== 'updateUserGroups' &&
      action !== 'batchUpdateUserGroups' &&
      action !== 'setOpenRegister' &&
      username === targetUsername
    ) {
      return actionResponse({ error: '无法对自己进行此操作' }, 400);
    }

    const adminConfig = await getConfig();

    let targetEntry: any = null;
    let isTargetAdmin = false;

    if (
      !['userGroup', 'batchUpdateUserGroups', 'setOpenRegister'].includes(
        action,
      ) &&
      targetUsername
    ) {
      targetEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === targetUsername,
      );

      if (
        targetEntry &&
        targetEntry.role === 'owner' &&
        !['changePassword', 'updateUserApis', 'updateUserGroups'].includes(
          action,
        )
      ) {
        return toActionResponse({ error: '无法操作站长' }, { status: 400 });
      }

      isTargetAdmin = targetEntry?.role === 'admin';
    }

    switch (action) {
      case 'add': {
        let cleanTargetUsername: string;
        try {
          cleanTargetUsername = assertValidUsername(targetUsername!);
        } catch (error) {
          return toActionResponse(
            {
              error: error instanceof Error ? error.message : '用户名格式错误',
            },
            { status: 400 },
          );
        }

        const targetExistsInDb = await db.checkUserExist(cleanTargetUsername);
        if (targetEntry || targetExistsInDb) {
          return toActionResponse({ error: '用户已存在' }, { status: 400 });
        }
        if (!targetPassword) {
          return toActionResponse(
            { error: '缺少目标用户密码' },
            { status: 400 },
          );
        }
        await db.registerUser(cleanTargetUsername, targetPassword);

        const { userGroup } = body as { userGroup?: string };

        const newUser: any = {
          username: cleanTargetUsername,
          role: 'user',
        };

        if (userGroup && userGroup.trim()) {
          newUser.tags = [userGroup];
        }

        adminConfig.UserConfig.Users.push(newUser);
        targetEntry =
          adminConfig.UserConfig.Users[adminConfig.UserConfig.Users.length - 1];
        break;
      }
      case 'ban': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (isTargetAdmin) {
          if (operatorRole !== 'owner') {
            return toActionResponse(
              { error: '仅站长可封禁管理员' },
              { status: 403 },
            );
          }
        }
        targetEntry.banned = true;
        break;
      }
      case 'unban': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (isTargetAdmin) {
          if (operatorRole !== 'owner') {
            return toActionResponse(
              { error: '仅站长可操作管理员' },
              { status: 403 },
            );
          }
        }
        targetEntry.banned = false;
        break;
      }
      case 'setAdmin': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (targetEntry.role === 'admin') {
          return toActionResponse(
            { error: '该用户已是管理员' },
            { status: 400 },
          );
        }
        if (operatorRole !== 'owner') {
          return toActionResponse(
            { error: '仅站长可设置管理员' },
            { status: 403 },
          );
        }
        targetEntry.role = 'admin';
        break;
      }
      case 'cancelAdmin': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (targetEntry.role !== 'admin') {
          return toActionResponse(
            { error: '目标用户不是管理员' },
            { status: 400 },
          );
        }
        if (operatorRole !== 'owner') {
          return toActionResponse(
            { error: '仅站长可取消管理员' },
            { status: 403 },
          );
        }
        targetEntry.role = 'user';
        break;
      }
      case 'changePassword': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }
        if (!targetPassword) {
          return toActionResponse({ error: '缺少新密码' }, { status: 400 });
        }

        if (targetEntry.role === 'owner') {
          return toActionResponse(
            { error: '无法修改站长密码' },
            { status: 403 },
          );
        }

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return toActionResponse(
            { error: '仅站长可修改其他管理员密码' },
            { status: 403 },
          );
        }

        await db.changePassword(targetUsername!, targetPassword);
        break;
      }
      case 'deleteUser': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }

        if (username === targetUsername) {
          return toActionResponse({ error: '不能删除自己' }, { status: 400 });
        }

        if (isTargetAdmin && operatorRole !== 'owner') {
          return toActionResponse(
            { error: '仅站长可删除管理员' },
            { status: 403 },
          );
        }

        await db.deleteUser(targetUsername!);

        const userIndex = adminConfig.UserConfig.Users.findIndex(
          (u) => u.username === targetUsername,
        );
        if (userIndex > -1) {
          adminConfig.UserConfig.Users.splice(userIndex, 1);
        }

        break;
      }
      case 'updateUserApis': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }

        const { enabledApis } = body as { enabledApis?: string[] };

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return toActionResponse(
            { error: '仅站长可配置其他管理员的采集源' },
            { status: 403 },
          );
        }

        if (enabledApis && enabledApis.length > 0) {
          targetEntry.enabledApis = enabledApis;
        } else {
          delete targetEntry.enabledApis;
        }

        break;
      }
      case 'userGroup': {
        const { groupAction, groupName, enabledApis } = body as {
          groupAction: 'add' | 'edit' | 'delete';
          groupName: string;
          enabledApis?: string[];
        };

        if (!adminConfig.UserConfig.Tags) {
          adminConfig.UserConfig.Tags = [];
        }

        switch (groupAction) {
          case 'add': {
            if (adminConfig.UserConfig.Tags.find((t) => t.name === groupName)) {
              return toActionResponse(
                { error: '用户组已存在' },
                { status: 400 },
              );
            }
            adminConfig.UserConfig.Tags.push({
              name: groupName,
              enabledApis: enabledApis || [],
            });
            break;
          }
          case 'edit': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(
              (t) => t.name === groupName,
            );
            if (groupIndex === -1) {
              return toActionResponse(
                { error: '用户组不存在' },
                { status: 404 },
              );
            }
            adminConfig.UserConfig.Tags[groupIndex].enabledApis =
              enabledApis || [];
            break;
          }
          case 'delete': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(
              (t) => t.name === groupName,
            );
            if (groupIndex === -1) {
              return toActionResponse(
                { error: '用户组不存在' },
                { status: 404 },
              );
            }

            const affectedUsers: string[] = [];
            adminConfig.UserConfig.Users.forEach((user) => {
              if (user.tags && user.tags.includes(groupName)) {
                affectedUsers.push(user.username);
                user.tags = user.tags.filter((tag) => tag !== groupName);
                if (user.tags.length === 0) {
                  delete user.tags;
                }
              }
            });

            adminConfig.UserConfig.Tags.splice(groupIndex, 1);

            console.log(
              `删除用户组 "${groupName}"，影响用户: ${
                affectedUsers.length > 0 ? affectedUsers.join(', ') : '无'
              }`,
            );

            break;
          }
          default:
            return toActionResponse(
              { error: '未知的用户组操作' },
              { status: 400 },
            );
        }
        break;
      }
      case 'updateUserGroups': {
        if (!targetEntry) {
          return toActionResponse({ error: '目标用户不存在' }, { status: 404 });
        }

        const { userGroups } = body as { userGroups: string[] };

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return toActionResponse(
            { error: '仅站长可配置其他管理员的用户组' },
            { status: 403 },
          );
        }

        if (userGroups && userGroups.length > 0) {
          targetEntry.tags = userGroups;
        } else {
          delete targetEntry.tags;
        }

        break;
      }
      case 'batchUpdateUserGroups': {
        const { usernames: rawUsernames, userGroups } = body as {
          usernames: string[];
          userGroups: string[];
        };

        if (
          !rawUsernames ||
          !Array.isArray(rawUsernames) ||
          rawUsernames.length === 0
        ) {
          return toActionResponse({ error: '缺少用户名列表' }, { status: 400 });
        }

        const usernames = rawUsernames.map((item) => normalizeUsername(item));

        if (operatorRole !== 'owner') {
          for (const targetUsername of usernames) {
            const targetUser = adminConfig.UserConfig.Users.find(
              (u) => u.username === targetUsername,
            );
            if (
              targetUser &&
              targetUser.role === 'admin' &&
              targetUsername !== username
            ) {
              return toActionResponse(
                { error: `管理员无法操作其他管理员 ${targetUsername}` },
                { status: 403 },
              );
            }
          }
        }

        for (const targetUsername of usernames) {
          const targetUser = adminConfig.UserConfig.Users.find(
            (u) => u.username === targetUsername,
          );
          if (targetUser) {
            if (userGroups && userGroups.length > 0) {
              targetUser.tags = userGroups;
            } else {
              delete targetUser.tags;
            }
          }
        }

        break;
      }
      case 'setOpenRegister': {
        const { openRegister } = body as { openRegister?: boolean };
        if (typeof openRegister !== 'boolean') {
          return toActionResponse(
            { error: '开放注册参数错误' },
            { status: 400 },
          );
        }
        adminConfig.UserConfig.OpenRegister = openRegister;
        break;
      }
      default:
        return toActionResponse({ error: '未知操作' }, { status: 400 });
    }

    await saveConfig(adminConfig);

    return toActionResponse(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    if (error instanceof ConfigConflictError) {
      return toActionResponse({ error: error.message }, { status: 409 });
    }
    console.error('用户管理操作失败:', error);
    return toActionResponse(
      {
        error: '用户管理操作失败',
      },
      { status: 500 },
    );
  }
}

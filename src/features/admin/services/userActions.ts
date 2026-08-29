import { randomBytes } from 'crypto';

import {
  findInactiveUsers,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
  parseInactiveDays,
  resolveConfirmedDeletions,
} from '@/features/admin/services/inactiveUsers';
import {
  buildInviteCode,
  CUSTOM_INVITE_CODE_RULE_MESSAGE,
  generateInviteCode,
  INVITE_MAX_USES_RULE_MESSAGE,
  isInviteCodeUsable,
  isValidCustomInviteCode,
  MAX_INVITE_CODES,
  MAX_INVITE_VALID_DAYS,
  MIN_INVITE_VALID_DAYS,
  normalizeInviteCode,
  parseInviteMaxUses,
  parseInviteValidDays,
} from '@/features/admin/services/inviteCodes';
import {
  ConfigConflictError,
  getConfig,
  invalidateConfigCache,
  saveConfig,
} from '@/lib/config';
import { db } from '@/lib/db';
import { validateAccountPassword } from '@/lib/password-policy';
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
  'previewInactiveUsers',
  'deleteInactiveUsers',
  'setRequireInviteCode',
  'createInviteCode',
  'deleteInviteCode',
] as const;

const TARGETLESS_ACTIONS = [
  'userGroup',
  'batchUpdateUserGroups',
  'setOpenRegister',
  'previewInactiveUsers',
  'deleteInactiveUsers',
  'setRequireInviteCode',
  'createInviteCode',
  'deleteInviteCode',
];

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

    if (!targetUsername && !TARGETLESS_ACTIONS.includes(action)) {
      return actionResponse({ error: '缺少目标用户名' }, 400);
    }

    if (
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      action !== 'updateUserApis' &&
      action !== 'updateUserGroups' &&
      !TARGETLESS_ACTIONS.includes(action) &&
      username === targetUsername
    ) {
      return actionResponse({ error: '无法对自己进行此操作' }, 400);
    }

    // 写操作必须基于最新配置，否则命中 TTL 缓存会误判用户不存在或撞版本冲突
    invalidateConfigCache();
    const adminConfig = await getConfig();

    let targetEntry: any = null;
    let isTargetAdmin = false;

    if (!TARGETLESS_ACTIONS.includes(action) && targetUsername) {
      targetEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === targetUsername,
      );

      if (targetEntry?.role === 'owner' && operatorRole !== 'owner') {
        return toActionResponse(
          { error: '仅站长可操作站长账号' },
          { status: 403 },
        );
      }

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
        const passwordError = validateAccountPassword(targetPassword);
        if (passwordError) {
          return toActionResponse({ error: passwordError }, { status: 400 });
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
        const passwordError = validateAccountPassword(targetPassword);
        if (passwordError) {
          return toActionResponse({ error: passwordError }, { status: 400 });
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
            { error: '仅站长可配置其他管理员的视频源权限' },
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
            if (targetUser?.role === 'owner') {
              return toActionResponse(
                { error: `管理员无法操作站长 ${targetUsername}` },
                { status: 403 },
              );
            }
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
      case 'previewInactiveUsers': {
        const inactiveDays = parseInactiveDays(
          (body as { inactiveDays?: unknown }).inactiveDays,
        );
        if (inactiveDays === null) {
          return toActionResponse(
            {
              error: `不活跃天数需在 ${MIN_INACTIVE_DAYS}-${MAX_INACTIVE_DAYS} 之间`,
            },
            { status: 400 },
          );
        }

        const candidates = findInactiveUsers({
          users: adminConfig.UserConfig.Users,
          lastActiveAt: await db.getAllUserLastActive(),
          inactiveDays,
          operatorUsername: username,
          includeNeverActive:
            (body as { includeNeverActive?: unknown }).includeNeverActive ===
            true,
        });

        return toActionResponse(
          { candidates },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      case 'deleteInactiveUsers': {
        const { usernames: rawUsernames } = body as { usernames?: unknown };
        const inactiveDays = parseInactiveDays(
          (body as { inactiveDays?: unknown }).inactiveDays,
        );
        if (inactiveDays === null) {
          return toActionResponse(
            {
              error: `不活跃天数需在 ${MIN_INACTIVE_DAYS}-${MAX_INACTIVE_DAYS} 之间`,
            },
            { status: 400 },
          );
        }

        if (!Array.isArray(rawUsernames) || rawUsernames.length === 0) {
          return toActionResponse({ error: '缺少用户名列表' }, { status: 400 });
        }

        const confirmedUsernames = rawUsernames
          .filter((item): item is string => typeof item === 'string')
          .map((item) => normalizeUsername(item));

        const candidates = findInactiveUsers({
          users: adminConfig.UserConfig.Users,
          lastActiveAt: await db.getAllUserLastActive(),
          inactiveDays,
          operatorUsername: username,
          includeNeverActive:
            (body as { includeNeverActive?: unknown }).includeNeverActive ===
            true,
        });
        const deletable = resolveConfirmedDeletions(
          candidates,
          confirmedUsernames,
        );

        for (const target of deletable) {
          await db.deleteUser(target);
        }

        if (deletable.length === 0) {
          return toActionResponse(
            {
              ok: true,
              deletedCount: 0,
              skippedCount: confirmedUsernames.length,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          );
        }

        await saveConfig(adminConfig);

        return toActionResponse(
          {
            ok: true,
            deletedCount: deletable.length,
            skippedCount: confirmedUsernames.length - deletable.length,
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
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
      case 'setRequireInviteCode': {
        const { requireInviteCode } = body as { requireInviteCode?: boolean };
        if (typeof requireInviteCode !== 'boolean') {
          return toActionResponse(
            { error: '邀请码开关参数错误' },
            { status: 400 },
          );
        }
        adminConfig.UserConfig.RequireInviteCode = requireInviteCode;
        break;
      }
      case 'createInviteCode': {
        const validDays = parseInviteValidDays(
          (body as { validDays?: unknown }).validDays,
        );
        if (validDays === null) {
          return toActionResponse(
            {
              error: `有效天数需在 ${MIN_INVITE_VALID_DAYS}-${MAX_INVITE_VALID_DAYS} 之间`,
            },
            { status: 400 },
          );
        }

        const maxUses = parseInviteMaxUses(
          (body as { maxUses?: unknown }).maxUses,
        );
        if (maxUses === null) {
          return toActionResponse(
            { error: INVITE_MAX_USES_RULE_MESSAGE },
            { status: 400 },
          );
        }

        const inviteCodes = adminConfig.UserConfig.InviteCodes || [];
        const activeCodes = inviteCodes.filter((item) =>
          isInviteCodeUsable(item),
        );
        if (activeCodes.length >= MAX_INVITE_CODES) {
          return toActionResponse(
            { error: `有效邀请码不能超过 ${MAX_INVITE_CODES} 个` },
            { status: 400 },
          );
        }

        const existing = new Set(inviteCodes.map((item) => item.code));
        const rawCustomCode = (body as { code?: unknown }).code;
        const hasCustomCode =
          typeof rawCustomCode === 'string' && rawCustomCode.trim() !== '';

        let code = '';
        if (hasCustomCode) {
          if (!isValidCustomInviteCode(rawCustomCode)) {
            return toActionResponse(
              { error: CUSTOM_INVITE_CODE_RULE_MESSAGE },
              { status: 400 },
            );
          }
          code = normalizeInviteCode(rawCustomCode);
          if (activeCodes.some((item) => item.code === code)) {
            return toActionResponse(
              { error: '该邀请码已存在' },
              { status: 409 },
            );
          }
        } else {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            code = generateInviteCode((size) => randomBytes(size));
            if (!existing.has(code)) break;
            code = '';
          }
          if (!code) {
            return toActionResponse(
              { error: '生成邀请码失败，请重试' },
              { status: 500 },
            );
          }
        }

        // 顺手清掉过期码和已用尽的码
        adminConfig.UserConfig.InviteCodes = [
          ...activeCodes,
          buildInviteCode({ code, validDays, createdBy: username, maxUses }),
        ];

        await saveConfig(adminConfig);

        return toActionResponse(
          { ok: true, code },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      case 'deleteInviteCode': {
        const code = normalizeInviteCode((body as { code?: unknown }).code);
        if (!code) {
          return toActionResponse({ error: '缺少邀请码' }, { status: 400 });
        }

        const inviteCodes = adminConfig.UserConfig.InviteCodes || [];
        const next = inviteCodes.filter((item) => item.code !== code);
        if (next.length === inviteCodes.length) {
          return toActionResponse({ error: '邀请码不存在' }, { status: 404 });
        }
        adminConfig.UserConfig.InviteCodes = next;
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

import { resolveSourceAccessRule } from '@/lib/source-access';
import type { UserAccess } from '@/lib/user-access';
import type { AdminConfig } from '@/types/admin';

export function configPermissionsChanged(
  previous: AdminConfig | null,
  next: AdminConfig,
): boolean {
  const key = (config: AdminConfig) =>
    JSON.stringify([
      (config.SourceConfig ?? [])
        .map((source) => [source.key, !!source.disabled, !!source.adminOnly])
        .sort(),
      (config.UserConfig?.Tags ?? [])
        .map((group) => [
          group.name,
          [...(group.enabledApis ?? [])].sort(),
          !!group.allowLive,
        ])
        .sort(),
      config.SiteConfig?.EnableLiveEntry === true,
      config.SiteConfig?.LiveAccess === 'groups',
    ]);
  return previous !== null && key(previous) !== key(next);
}

export function accessPermissions(
  user: UserAccess,
  config: AdminConfig | null,
): { sources: ReadonlySet<string>; live: boolean } {
  const rule = resolveSourceAccessRule(user, config?.UserConfig?.Tags);
  const sources = (config?.SourceConfig ?? [])
    .filter(
      (source) =>
        !source.disabled &&
        (!source.adminOnly || user.role !== 'user') &&
        (!rule || rule.keys.has(source.key)),
    )
    .map((source) => source.key);
  const live =
    config?.SiteConfig?.EnableLiveEntry === true &&
    (config.SiteConfig.LiveAccess !== 'groups' ||
      user.role !== 'user' ||
      (config.UserConfig?.Tags ?? []).some(
        (group) => group.allowLive && user.tags?.includes(group.name),
      ));
  return { sources: new Set(sources), live };
}

export function accessPermissionChanges(
  previous: ReturnType<typeof accessPermissions>,
  next: ReturnType<typeof accessPermissions>,
): UserNoticePayload | null {
  const sourcesAdded = [...next.sources].filter(
    (key) => !previous.sources.has(key),
  ).length;
  const sourcesRemoved = [...previous.sources].filter(
    (key) => !next.sources.has(key),
  ).length;
  if (!sourcesAdded && !sourcesRemoved && previous.live === next.live)
    return null;
  return {
    sourcesAdded,
    sourcesRemoved,
    ...(previous.live !== next.live ? { liveAllowed: next.live } : {}),
  };
}

export type UserNoticeKind =
  | 'content-moderated'
  | 'report-result'
  | 'account-change';
export interface UserNoticePayload {
  title?: string;
  year?: string;
  contentType?: 'review' | 'reply' | 'danmaku';
  count?: number;
  sourcesAdded?: number;
  sourcesRemoved?: number;
  liveAllowed?: boolean;
}
export interface UserNoticeMessage {
  id: string;
  type: UserNoticeKind;
  action: string;
  payload: UserNoticePayload;
  createdAt: number;
}
export function parseUserNoticeId(
  id: string,
): { createdAt: number; rowId: string } | null {
  const match = /^user-notice:(\d+):([a-f0-9-]{36})$/.exec(id);
  const createdAt = Number(match?.[1]);
  return match && Number.isSafeInteger(createdAt)
    ? { createdAt, rowId: match[2] }
    : null;
}
export function isUserNotice(message: {
  type: string;
}): message is UserNoticeMessage {
  return ['content-moderated', 'report-result', 'account-change'].includes(
    message.type,
  );
}
export function userNoticeText(
  message: Pick<UserNoticeMessage, 'type' | 'action' | 'payload'>,
): string {
  const { type, action, payload } = message;
  if (type === 'account-change') {
    if (action === 'permissions-changed') {
      const added = payload.sourcesAdded ?? 0;
      const removed = payload.sourcesRemoved ?? 0;
      const changes: string[] = [];
      if (added > 0 && removed > 0)
        changes.push(
          `你的可用视频源已调整：新增 ${added} 个，移除 ${removed} 个`,
        );
      else if (added > 0) changes.push(`你的可用视频源增加了 ${added} 个`);
      else if (removed > 0) changes.push(`你的可用视频源减少了 ${removed} 个`);
      if (typeof payload.liveAllowed === 'boolean')
        changes.push(
          payload.liveAllowed
            ? '你现在可以观看直播了'
            : '你的直播访问权限已关闭',
        );
      if (changes.length) return changes.join('；');
    }
    return (
      (
        {
          'set-admin': '你已被设为管理员',
          'cancel-admin': '你的管理员身份已取消',
          'password-changed': '管理员已修改你的登录密码',
          unban: '你的账号已解除封禁',
          'permissions-changed': '你的访问权限已更新',
        } as Record<string, string>
      )[action] ?? '你的账号信息已更新'
    );
  }
  const work = payload.title ? `《${payload.title}》` : '';
  if (type === 'report-result') {
    const result =
      action === 'dismiss'
        ? '未作处理'
        : action === 'mark-spoiler'
          ? '已标记剧透'
          : '已删除相关内容';
    return `你对${work}${payload.contentType === 'reply' ? '回复' : '评价'}的举报已处理：${result}`;
  }
  if (action === 'mark-spoiler') return `你对${work}的评价已被标记为剧透`;
  const content =
    payload.contentType === 'danmaku'
      ? '弹幕'
      : payload.contentType === 'reply'
        ? '回复'
        : '评价及相关回复';
  return `你${work ? `在${work}` : ''}的${payload.count && payload.count > 1 ? `${payload.count} 条` : ''}${content}已被管理员删除`;
}
export function accessNoticeAction(
  previous: UserAccess,
  next: UserAccess,
): string | null {
  if (previous.role !== next.role)
    return next.role === 'admin' ? 'set-admin' : 'cancel-admin';
  if (previous.banned && !next.banned) return 'unban';
  const same = (a?: string[], b?: string[]) =>
    JSON.stringify([...(a ?? [])].sort()) ===
    JSON.stringify([...(b ?? [])].sort());
  return !same(previous.enabledApis, next.enabledApis) ||
    !same(previous.tags, next.tags)
    ? 'permissions-changed'
    : null;
}

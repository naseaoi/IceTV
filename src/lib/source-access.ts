export type SourceAccessOrigin = 'user' | 'group';

export interface SourceAccessRule {
  origin: SourceAccessOrigin;
  keys: ReadonlySet<string>;
}

interface SourceAccessGroup {
  name: string;
  enabledApis?: readonly string[];
}

// 用户单独配置优先且整体覆盖用户组；用户组取并集；都未限定时返回 null 表示不限制
export function resolveSourceAccessRule(
  user: { enabledApis?: readonly string[]; tags?: readonly string[] },
  groups: readonly SourceAccessGroup[] | undefined,
): SourceAccessRule | null {
  if (user.enabledApis?.length) {
    return { origin: 'user', keys: new Set(user.enabledApis) };
  }

  if (!user.tags?.length || !groups?.length) return null;

  const keys = new Set<string>();
  for (const tagName of user.tags) {
    const group = groups.find((item) => item.name === tagName);
    group?.enabledApis?.forEach((key) => keys.add(key));
  }
  return keys.size > 0 ? { origin: 'group', keys } : null;
}

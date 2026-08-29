export const MIN_INACTIVE_DAYS = 1;
export const MAX_INACTIVE_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InactiveCandidateUser = {
  username: string;
  role: 'user' | 'admin' | 'owner';
};

export type InactiveCandidate = {
  username: string;
  lastActiveAt: number;
  inactiveDays: number;
};

export function parseInactiveDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const days = Math.floor(value);
  if (days < MIN_INACTIVE_DAYS || days > MAX_INACTIVE_DAYS) return null;
  return days;
}

// owner / admin 豁免，无活跃记录的用户不纳入
export function findInactiveUsers({
  users,
  lastActiveAt,
  inactiveDays,
  operatorUsername,
  now = Date.now(),
}: {
  users: InactiveCandidateUser[];
  lastActiveAt: Record<string, number>;
  inactiveDays: number;
  operatorUsername: string;
  now?: number;
}): InactiveCandidate[] {
  const threshold = now - inactiveDays * DAY_MS;
  const stale: InactiveCandidate[] = [];

  for (const user of users) {
    if (user.role !== 'user') continue;
    if (user.username === operatorUsername) continue;

    const activeAt = lastActiveAt[user.username];
    if (!activeAt || activeAt > threshold) continue;

    stale.push({
      username: user.username,
      lastActiveAt: activeAt,
      inactiveDays: Math.floor((now - activeAt) / DAY_MS),
    });
  }

  return stale.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
}

// 只删既在确认名单又仍然符合阈值的用户
export function resolveConfirmedDeletions(
  candidates: InactiveCandidate[],
  confirmedUsernames: string[],
): string[] {
  const confirmed = new Set(confirmedUsernames);
  return candidates
    .filter((candidate) => confirmed.has(candidate.username))
    .map((candidate) => candidate.username);
}

import { normalizeUsername } from '@/lib/username';

export interface UsernameCollision {
  legacy: string;
  canonical: string;
}

/** 归一化后与自身不同的用户名需要迁移 */
export function needsUsernameMigration(username: string): boolean {
  return username !== normalizeUsername(username);
}

export function planUsernameMigration(
  usernames: string[],
): UsernameCollision[] {
  const plan: UsernameCollision[] = [];
  for (const legacy of usernames) {
    if (!needsUsernameMigration(legacy)) continue;
    plan.push({ legacy, canonical: normalizeUsername(legacy) });
  }
  return plan;
}

/** 合并同一条目的两份 JSON，保留 save_time 更新的一份 */
export function pickNewerJson(
  canonicalJson: string | undefined,
  legacyJson: string,
): string {
  if (!canonicalJson) return legacyJson;
  const canonicalTime = readSaveTime(canonicalJson);
  const legacyTime = readSaveTime(legacyJson);
  return legacyTime > canonicalTime ? legacyJson : canonicalJson;
}

function readSaveTime(json: string): number {
  try {
    const parsed = JSON.parse(json) as { save_time?: unknown };
    const saveTime = Number(parsed?.save_time);
    return Number.isFinite(saveTime) ? saveTime : 0;
  } catch {
    return 0;
  }
}

/** 规范用户的关键词在前，去重后截断 */
export function mergeSearchKeywords(
  canonicalKeywords: string[],
  legacyKeywords: string[],
  limit: number,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const keyword of [...canonicalKeywords, ...legacyKeywords]) {
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    merged.push(keyword);
    if (merged.length >= limit) break;
  }
  return merged;
}

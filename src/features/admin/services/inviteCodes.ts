export const INVITE_CODE_LENGTH = 12;
export const MAX_INVITE_CODES = 200;
export const MIN_INVITE_VALID_DAYS = 1;
export const MAX_INVITE_VALID_DAYS = 365;
export const CUSTOM_INVITE_CODE_MIN_LENGTH = 4;
export const CUSTOM_INVITE_CODE_MAX_LENGTH = 32;
export const MIN_INVITE_MAX_USES = 1;
export const MAX_INVITE_MAX_USES = 9999;

export const INVITE_MAX_USES_RULE_MESSAGE = `可用次数需在 ${MIN_INVITE_MAX_USES}-${MAX_INVITE_MAX_USES} 之间，留空表示不限次数`;

export const CUSTOM_INVITE_CODE_RULE_MESSAGE = `自定义邀请码只能包含字母、数字、下划线和连字符，长度 ${CUSTOM_INVITE_CODE_MIN_LENGTH}-${CUSTOM_INVITE_CODE_MAX_LENGTH} 字符`;

export const INVITE_CODE_UNUSABLE_MESSAGE = '邀请码无效、已过期或已用尽';

const DAY_MS = 24 * 60 * 60 * 1000;

// 去掉易混淆的 0/O/1/I
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const CUSTOM_CODE_PATTERN = /^[A-Z0-9_-]+$/;

export type InviteCode = {
  code: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string;
  // 省略或 0 表示不限次数
  maxUses?: number;
  usedCount?: number;
};

export function parseInviteValidDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const days = Math.floor(value);
  if (days < MIN_INVITE_VALID_DAYS || days > MAX_INVITE_VALID_DAYS) return null;
  return days;
}

export function parseInviteMaxUses(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const uses = Math.floor(value);
  if (uses === 0) return undefined;
  if (uses < MIN_INVITE_MAX_USES || uses > MAX_INVITE_MAX_USES) return null;
  return uses;
}

export function normalizeInviteCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

export function isValidCustomInviteCode(value: unknown): boolean {
  const code = normalizeInviteCode(value);
  return (
    code.length >= CUSTOM_INVITE_CODE_MIN_LENGTH &&
    code.length <= CUSTOM_INVITE_CODE_MAX_LENGTH &&
    CUSTOM_CODE_PATTERN.test(code)
  );
}

export function generateInviteCode(
  randomBytes: (size: number) => Uint8Array,
): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

export function buildInviteCode({
  code,
  validDays,
  createdBy,
  maxUses,
  now = Date.now(),
}: {
  code: string;
  validDays: number;
  createdBy: string;
  maxUses?: number;
  now?: number;
}): InviteCode {
  return {
    code,
    createdAt: now,
    expiresAt: now + validDays * DAY_MS,
    createdBy,
    ...(maxUses ? { maxUses, usedCount: 0 } : {}),
  };
}

export function isInviteCodeExpired(
  inviteCode: InviteCode,
  now = Date.now(),
): boolean {
  return inviteCode.expiresAt <= now;
}

export function isInviteCodeExhausted(inviteCode: InviteCode): boolean {
  if (!inviteCode.maxUses) return false;
  return (inviteCode.usedCount || 0) >= inviteCode.maxUses;
}

export function isInviteCodeUsable(
  inviteCode: InviteCode,
  now = Date.now(),
): boolean {
  return (
    !isInviteCodeExpired(inviteCode, now) && !isInviteCodeExhausted(inviteCode)
  );
}

export function getInviteCodeRemainingUses(
  inviteCode: InviteCode,
): number | null {
  if (!inviteCode.maxUses) return null;
  return Math.max(0, inviteCode.maxUses - (inviteCode.usedCount || 0));
}

export function findUsableInviteCode(
  inviteCodes: InviteCode[],
  rawCode: unknown,
  now = Date.now(),
): InviteCode | null {
  const code = normalizeInviteCode(rawCode);
  if (!code) return null;
  const matched = inviteCodes.find((item) => item.code === code);
  if (!matched || !isInviteCodeUsable(matched, now)) return null;
  return matched;
}

// 数据库用量为准，缺行时回落到配置里的历史值
export function mergeInviteCodeUsage(
  inviteCodes: InviteCode[] | undefined,
  usage: Record<string, number>,
): InviteCode[] {
  if (!inviteCodes) return [];
  return inviteCodes.map((item) => {
    if (!item.maxUses) return item;
    const usedCount = usage[item.code] ?? item.usedCount ?? 0;
    return { ...item, usedCount };
  });
}

export function sanitizeInviteCodes(value: unknown): InviteCode[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: InviteCode[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const code = normalizeInviteCode(raw.code);
    if (!code || seen.has(code)) continue;
    if (
      typeof raw.createdAt !== 'number' ||
      !Number.isFinite(raw.createdAt) ||
      typeof raw.expiresAt !== 'number' ||
      !Number.isFinite(raw.expiresAt)
    ) {
      continue;
    }
    seen.add(code);
    const maxUses =
      typeof raw.maxUses === 'number' && Number.isFinite(raw.maxUses)
        ? Math.max(0, Math.floor(raw.maxUses))
        : 0;
    const usedCount =
      typeof raw.usedCount === 'number' && Number.isFinite(raw.usedCount)
        ? Math.max(0, Math.floor(raw.usedCount))
        : 0;
    result.push({
      code,
      createdAt: raw.createdAt,
      expiresAt: raw.expiresAt,
      createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '',
      ...(maxUses ? { maxUses, usedCount } : {}),
    });
    if (result.length >= MAX_INVITE_CODES) break;
  }

  return result;
}

export function countActiveInviteCodes(
  inviteCodes: InviteCode[],
  now = Date.now(),
): number {
  return inviteCodes.filter((item) => isInviteCodeUsable(item, now)).length;
}

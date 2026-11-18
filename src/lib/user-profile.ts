import type { LibraryVisibility } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

// 昵称前后端共用校验；唯一性按 nicknameNorm 判定
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;
export const BIO_MAX_LENGTH = 60;
export const SHOWCASE_MAX_ITEMS = 3;
// 关注 / 粉丝列表每页条数，前端按它截断骨架条数
export const FOLLOW_PAGE_SIZE = 30;

export const NICKNAME_RULE_MESSAGE = `昵称限 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符，可用文字、数字、下划线、连字符和间隔号`;

const NICKNAME_PATTERN = /^[\p{L}\p{N}_\-·]+$/u;
const RESERVED_NICKNAMES = [
  'admin',
  'owner',
  'system',
  '管理员',
  '站长',
  '官方',
  '系统',
];

export class ProfileValidationError extends Error {}

export function normalizeNickname(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

// 保留名只对站长开放；存储层只校验格式，保留名由各入口按角色判定
export function validateNickname(
  value: unknown,
  { allowReserved = false }: { allowReserved?: boolean } = {},
): {
  nickname: string;
  nicknameNorm: string;
} {
  if (typeof value !== 'string') {
    throw new ProfileValidationError(NICKNAME_RULE_MESSAGE);
  }
  const nickname = value.normalize('NFKC').trim();
  const length = Array.from(nickname).length;
  if (
    length < NICKNAME_MIN_LENGTH ||
    length > NICKNAME_MAX_LENGTH ||
    !NICKNAME_PATTERN.test(nickname)
  ) {
    throw new ProfileValidationError(NICKNAME_RULE_MESSAGE);
  }
  const nicknameNorm = normalizeNickname(nickname);
  if (!allowReserved && RESERVED_NICKNAMES.includes(nicknameNorm)) {
    throw new ProfileValidationError('该昵称为保留名，请换一个');
  }
  return { nickname, nicknameNorm };
}

const AVATAR_SEED_PATTERN = /^[A-Za-z0-9]{8,24}$/;

// 头像种子：null 表示恢复按 profileId 生成的默认头像
export function validateAvatarSeed(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !AVATAR_SEED_PATTERN.test(value)) {
    throw new ProfileValidationError('头像参数无效');
  }
  return value;
}

export function createAvatarSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export function validateLibraryVisibility(value: unknown): LibraryVisibility {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3
  )
    throw new ProfileValidationError('收藏公开等级无效');
  return value as LibraryVisibility;
}

export function validateBio(value: unknown): string | null {
  if (typeof value !== 'string')
    throw new ProfileValidationError('简介必须为字符串');
  const bio = value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .replace(/\p{Cc}/gu, '')
    .replace(/ +/g, ' ')
    .trim();
  if (Array.from(bio).length > BIO_MAX_LENGTH)
    throw new ProfileValidationError(`简介最多 ${BIO_MAX_LENGTH} 个字`);
  return bio || null;
}

export function validateShowcaseKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string'))
    throw new ProfileValidationError('本命作品必须为收藏键数组');
  const keys = [...new Set(value as string[])];
  if (keys.length > SHOWCASE_MAX_ITEMS)
    throw new ProfileValidationError(
      `本命作品最多选择 ${SHOWCASE_MAX_ITEMS} 部`,
    );
  if (keys.some((key) => key.length > 512 || !parseStorageKey(key)))
    throw new ProfileValidationError('本命作品收藏键无效');
  return keys;
}

export function validateWatchTimePublic(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new ProfileValidationError('观影时长公开状态必须为布尔值');
  return value;
}

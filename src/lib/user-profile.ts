// 昵称前后端共用校验；唯一性按 nicknameNorm 判定
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

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

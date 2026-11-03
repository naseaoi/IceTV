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

export class NicknameValidationError extends Error {}

export function normalizeNickname(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function validateNickname(value: unknown): {
  nickname: string;
  nicknameNorm: string;
} {
  if (typeof value !== 'string') {
    throw new NicknameValidationError(NICKNAME_RULE_MESSAGE);
  }
  const nickname = value.normalize('NFKC').trim();
  const length = Array.from(nickname).length;
  if (
    length < NICKNAME_MIN_LENGTH ||
    length > NICKNAME_MAX_LENGTH ||
    !NICKNAME_PATTERN.test(nickname)
  ) {
    throw new NicknameValidationError(NICKNAME_RULE_MESSAGE);
  }
  const nicknameNorm = normalizeNickname(nickname);
  if (RESERVED_NICKNAMES.includes(nicknameNorm)) {
    throw new NicknameValidationError('该昵称为保留名，请换一个');
  }
  return { nickname, nicknameNorm };
}

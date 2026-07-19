export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_MAX_LENGTH = 64;

export const USERNAME_RULE_MESSAGE =
  '用户名只能包含字母、数字、点、下划线和连字符，长度 4-64 字符，且不能为保留名';
const USERNAME_FORMAT_MESSAGE =
  '用户名只能包含字母、数字、点、下划线和连字符，长度不超过 64';

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;
const RESERVED_USERNAMES = ['admin'];

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

// 宽松格式校验：用于存储写入与备份导入，兼容存量用户名
export function isValidUsernameFormat(value: string): boolean {
  const username = normalizeUsername(value);
  return (
    username.length > 0 &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username)
  );
}

export function assertValidUsernameFormat(value: string): string {
  const username = normalizeUsername(value);
  if (!isValidUsernameFormat(username)) {
    throw new Error(USERNAME_FORMAT_MESSAGE);
  }
  return username;
}

// 严格规则校验：仅用于新建账号入口
export function isValidUsername(value: string): boolean {
  const username = normalizeUsername(value);
  return (
    isValidUsernameFormat(username) &&
    username.length >= USERNAME_MIN_LENGTH &&
    !RESERVED_USERNAMES.includes(username)
  );
}

export function assertValidUsername(value: string): string {
  const username = normalizeUsername(value);
  if (!isValidUsername(username)) {
    throw new Error(USERNAME_RULE_MESSAGE);
  }
  return username;
}

export const USERNAME_MAX_LENGTH = 64;

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  const username = normalizeUsername(value);
  return (
    username.length > 0 &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username)
  );
}

export function assertValidUsername(value: string): string {
  const username = normalizeUsername(value);
  if (!isValidUsername(username)) {
    throw new Error(
      '用户名只能包含字母、数字、点、下划线和连字符，长度不超过 64',
    );
  }
  return username;
}

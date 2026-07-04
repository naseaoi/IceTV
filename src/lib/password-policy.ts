const MIN_PASSWORD_LENGTH = 8;

export function validateAccountPassword(password: string): string | null {
  if (!password) {
    return '密码不能为空';
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度不能少于 ${MIN_PASSWORD_LENGTH} 位`;
  }

  return null;
}

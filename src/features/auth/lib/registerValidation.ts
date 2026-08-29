import { validateAccountPassword } from '@/lib/password-policy';
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_RULE_MESSAGE,
} from '@/lib/username';

export type RegisterField =
  | 'username'
  | 'password'
  | 'confirmPassword'
  | 'inviteCode';

export type RegisterFieldErrors = Partial<Record<RegisterField, string>>;

export interface RegisterFormValues {
  username: string;
  password: string;
  confirmPassword: string;
  inviteCode: string;
  inviteCodeRequired: boolean;
}

export function validateUsernameField(value: string): string | null {
  const username = normalizeUsername(value);
  if (!username) return '用户名不能为空';
  if (!isValidUsername(username)) return USERNAME_RULE_MESSAGE;
  return null;
}

export function validatePasswordField(value: string): string | null {
  return validateAccountPassword(value);
}

export function validateConfirmPasswordField(
  password: string,
  confirmPassword: string,
): string | null {
  if (!confirmPassword) return '请再次输入密码';
  if (password !== confirmPassword) return '两次输入的密码不一致';
  return null;
}

export function validateInviteCodeField(
  value: string,
  required: boolean,
): string | null {
  if (!required) return null;
  if (!value.trim()) return '请输入邀请码';
  return null;
}

export function validateRegisterForm(
  values: RegisterFormValues,
): RegisterFieldErrors {
  const errors: RegisterFieldErrors = {};

  const username = validateUsernameField(values.username);
  if (username) errors.username = username;

  const password = validatePasswordField(values.password);
  if (password) errors.password = password;

  const confirmPassword = validateConfirmPasswordField(
    values.password,
    values.confirmPassword,
  );
  if (confirmPassword) errors.confirmPassword = confirmPassword;

  const inviteCode = validateInviteCodeField(
    values.inviteCode,
    values.inviteCodeRequired,
  );
  if (inviteCode) errors.inviteCode = inviteCode;

  return errors;
}

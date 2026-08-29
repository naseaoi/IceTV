import {
  validateConfirmPasswordField,
  validateInviteCodeField,
  validatePasswordField,
  validateRegisterForm,
  validateUsernameField,
} from '@/features/auth/lib/registerValidation';

describe('registerValidation', () => {
  it('用户名为空时报错', () => {
    expect(validateUsernameField('   ')).toBe('用户名不能为空');
  });

  it('用户名过短或含非法字符时报错', () => {
    expect(validateUsernameField('ab')).toBeTruthy();
    expect(validateUsernameField('用户名')).toBeTruthy();
    expect(validateUsernameField('admin')).toBeTruthy();
  });

  it('合法用户名通过，且大小写归一化', () => {
    expect(validateUsernameField('Demo_User-1')).toBeNull();
  });

  it('密码短于 8 位时报错', () => {
    expect(validatePasswordField('1234567')).toBeTruthy();
    expect(validatePasswordField('12345678')).toBeNull();
  });

  it('确认密码为空或不一致时报错', () => {
    expect(validateConfirmPasswordField('12345678', '')).toBe('请再次输入密码');
    expect(validateConfirmPasswordField('12345678', '87654321')).toBe(
      '两次输入的密码不一致',
    );
    expect(validateConfirmPasswordField('12345678', '12345678')).toBeNull();
  });

  it('仅在要求邀请码时校验邀请码', () => {
    expect(validateInviteCodeField('', false)).toBeNull();
    expect(validateInviteCodeField('', true)).toBe('请输入邀请码');
    expect(validateInviteCodeField(' ABC ', true)).toBeNull();
  });

  it('整表校验汇总各字段错误', () => {
    const errors = validateRegisterForm({
      username: 'ab',
      password: '123',
      confirmPassword: '456',
      inviteCode: '',
      inviteCodeRequired: true,
    });

    expect(Object.keys(errors).sort()).toEqual([
      'confirmPassword',
      'inviteCode',
      'password',
      'username',
    ]);
  });

  it('全部合法时返回空对象', () => {
    const errors = validateRegisterForm({
      username: 'demo_user',
      password: 'abcd1234',
      confirmPassword: 'abcd1234',
      inviteCode: 'WELCOME',
      inviteCodeRequired: true,
    });

    expect(errors).toEqual({});
  });
});

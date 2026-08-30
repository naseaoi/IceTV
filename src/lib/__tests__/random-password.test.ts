/** @jest-environment node */

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { validateAccountPassword } from '@/lib/password-policy';
import {
  generateRandomPassword,
  RANDOM_PASSWORD_LENGTH,
} from '@/lib/random-password';

installCryptoPolyfill();

describe('generateRandomPassword', () => {
  it('默认长度符合约定', () => {
    expect(generateRandomPassword()).toHaveLength(RANDOM_PASSWORD_LENGTH);
  });

  it('尊重传入长度', () => {
    expect(generateRandomPassword(24)).toHaveLength(24);
  });

  it('四类字符各至少出现一次', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateRandomPassword();
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%^&*\-_=+]/);
    }
  });

  it('不含易混淆字符', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRandomPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it('通过账号密码校验', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(validateAccountPassword(generateRandomPassword())).toBeNull();
    }
  });

  it('必填字符不会固定落在开头', () => {
    const prefixes = new Set(
      Array.from({ length: 100 }, () => generateRandomPassword()[0]),
    );
    expect(prefixes.size).toBeGreaterThan(4);
  });

  it('连续生成不重复', () => {
    const seen = new Set(
      Array.from({ length: 100 }, () => generateRandomPassword()),
    );
    expect(seen.size).toBe(100);
  });
});

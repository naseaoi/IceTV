import { createCipheriv, createHash, randomBytes } from 'crypto';

import { SimpleCrypto } from '../crypto';

const KEY_SIZE = 32;
const IV_SIZE = 16;
const OPENSSL_PREFIX = Buffer.from('Salted__');

function legacyEvpKDF(
  password: Buffer,
  salt: Buffer,
): {
  key: Buffer;
  iv: Buffer;
} {
  const parts: Buffer[] = [];
  let block = Buffer.alloc(0);

  while (Buffer.concat(parts).length < KEY_SIZE + IV_SIZE) {
    const hash = createHash('md5');
    hash.update(block);
    hash.update(password);
    hash.update(salt);
    block = Buffer.from(hash.digest());
    parts.push(block);
  }

  const all = Buffer.concat(parts);
  return {
    key: all.subarray(0, KEY_SIZE),
    iv: all.subarray(KEY_SIZE, KEY_SIZE + IV_SIZE),
  };
}

function encryptLegacy(data: string, password: string): string {
  const salt = randomBytes(8);
  const { key, iv } = legacyEvpKDF(Buffer.from(password, 'utf8'), salt);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final(),
  ]);

  return Buffer.concat([OPENSSL_PREFIX, salt, encrypted]).toString('base64');
}

describe('SimpleCrypto', () => {
  it('encrypts and decrypts v2 payloads', () => {
    const encrypted = SimpleCrypto.encrypt('backup payload', 'strong-password');

    expect(encrypted.startsWith('IceTVv2:')).toBe(true);
    expect(SimpleCrypto.decrypt(encrypted, 'strong-password')).toBe(
      'backup payload',
    );
  });

  it('rejects tampered v2 payloads', () => {
    const encrypted = SimpleCrypto.encrypt('backup payload', 'strong-password');
    const payload = Buffer.from(encrypted.slice('IceTVv2:'.length), 'base64');
    payload[payload.length - 1] ^= 1;
    const tampered = `IceTVv2:${payload.toString('base64')}`;

    expect(() => SimpleCrypto.decrypt(tampered, 'strong-password')).toThrow(
      '解密失败，请检查密码是否正确',
    );
  });

  it('decrypts legacy OpenSSL payloads', () => {
    const encrypted = encryptLegacy('legacy payload', 'legacy-password');

    expect(SimpleCrypto.decrypt(encrypted, 'legacy-password')).toBe(
      'legacy payload',
    );
  });
});

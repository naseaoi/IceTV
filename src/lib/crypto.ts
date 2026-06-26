import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto';

const KEY_SIZE = 32;
const LEGACY_IV_SIZE = 16;
const LEGACY_SALT_SIZE = 8;
const LEGACY_OPENSSL_PREFIX = Buffer.from('Salted__');

const V2_PREFIX = 'IceTVv2:';
const V2_SALT_SIZE = 16;
const V2_IV_SIZE = 12;
const V2_AUTH_TAG_SIZE = 16;
const V2_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

function legacyEvpKDF(
  password: Buffer,
  salt: Buffer,
): {
  key: Buffer;
  iv: Buffer;
} {
  const parts: Buffer[] = [];
  let block = Buffer.alloc(0);

  while (Buffer.concat(parts).length < KEY_SIZE + LEGACY_IV_SIZE) {
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
    iv: all.subarray(KEY_SIZE, KEY_SIZE + LEGACY_IV_SIZE),
  };
}

function deriveV2Key(password: string, salt: Buffer): Buffer {
  return scryptSync(
    Buffer.from(password, 'utf8'),
    salt,
    KEY_SIZE,
    V2_SCRYPT_OPTIONS,
  );
}

function encryptV2(data: string, password: string): string {
  const salt = randomBytes(V2_SALT_SIZE);
  const iv = randomBytes(V2_IV_SIZE);
  const key = deriveV2Key(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: V2_AUTH_TAG_SIZE,
  });
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${V2_PREFIX}${Buffer.concat([salt, iv, authTag, encrypted]).toString(
    'base64',
  )}`;
}

function decryptV2(encryptedData: string, password: string): string {
  const payload = Buffer.from(encryptedData.slice(V2_PREFIX.length), 'base64');
  const minPayloadSize = V2_SALT_SIZE + V2_IV_SIZE + V2_AUTH_TAG_SIZE + 1;

  if (payload.length < minPayloadSize) {
    throw new Error('无效的加密数据格式');
  }

  const salt = payload.subarray(0, V2_SALT_SIZE);
  const iv = payload.subarray(V2_SALT_SIZE, V2_SALT_SIZE + V2_IV_SIZE);
  const authTag = payload.subarray(
    V2_SALT_SIZE + V2_IV_SIZE,
    V2_SALT_SIZE + V2_IV_SIZE + V2_AUTH_TAG_SIZE,
  );
  const ciphertext = payload.subarray(
    V2_SALT_SIZE + V2_IV_SIZE + V2_AUTH_TAG_SIZE,
  );
  const key = deriveV2Key(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: V2_AUTH_TAG_SIZE,
  });

  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

function decryptLegacy(encryptedData: string, password: string): string {
  const raw = Buffer.from(encryptedData, 'base64');

  if (
    raw.length < LEGACY_OPENSSL_PREFIX.length + LEGACY_SALT_SIZE ||
    !raw.subarray(0, LEGACY_OPENSSL_PREFIX.length).equals(LEGACY_OPENSSL_PREFIX)
  ) {
    throw new Error('无效的加密数据格式');
  }

  const salt = raw.subarray(
    LEGACY_OPENSSL_PREFIX.length,
    LEGACY_OPENSSL_PREFIX.length + LEGACY_SALT_SIZE,
  );
  const ciphertext = raw.subarray(
    LEGACY_OPENSSL_PREFIX.length + LEGACY_SALT_SIZE,
  );
  const { key, iv } = legacyEvpKDF(Buffer.from(password, 'utf8'), salt);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');

  if (!decrypted) {
    throw new Error('解密失败，请检查密码是否正确');
  }

  return decrypted;
}

export class SimpleCrypto {
  static encrypt(data: string, password: string): string {
    try {
      return encryptV2(data, password);
    } catch {
      throw new Error('加密失败');
    }
  }

  static decrypt(encryptedData: string, password: string): string {
    try {
      if (encryptedData.startsWith(V2_PREFIX)) {
        return decryptV2(encryptedData, password);
      }

      return decryptLegacy(encryptedData, password);
    } catch {
      throw new Error('解密失败，请检查密码是否正确');
    }
  }

  static canDecrypt(encryptedData: string, password: string): boolean {
    try {
      const decrypted = this.decrypt(encryptedData, password);
      return decrypted.length > 0;
    } catch {
      return false;
    }
  }
}

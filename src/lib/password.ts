import bcryptjs from 'bcryptjs';
import crypto from 'crypto';

const BCRYPT_ROUNDS = 10;
type BcryptApi = {
  hash(plain: string, rounds: number): Promise<string>;
  compare(plain: string, stored: string): Promise<boolean>;
};

let bcryptApiPromise: Promise<BcryptApi> | null = null;

function getBcryptApi(): Promise<BcryptApi> {
  if (!bcryptApiPromise) {
    bcryptApiPromise = import('bcrypt')
      .then((mod) => {
        const loaded = mod as unknown as { default?: BcryptApi } & BcryptApi;
        return loaded.default ?? loaded;
      })
      .catch((error) => {
        console.warn('原生 bcrypt 加载失败，使用 bcryptjs:', error);
        return bcryptjs;
      });
  }

  return bcryptApiPromise;
}

export async function hashPassword(plain: string): Promise<string> {
  const bcrypt = await getBcryptApi();
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ match: boolean; needsRehash: boolean }> {
  const isBcrypt = /^\$2[aby]\$\d{2}\$.{53}$/.test(stored);

  if (isBcrypt) {
    const bcrypt = await getBcryptApi();
    const comparableHash = stored.startsWith('$2y$')
      ? `$2b$${stored.slice(4)}`
      : stored;
    const match = await bcrypt.compare(plain, comparableHash);
    return { match, needsRehash: false };
  }

  const plainBuffer = Buffer.from(plain, 'utf8');
  const storedBuffer = Buffer.from(stored, 'utf8');
  const match =
    plainBuffer.length === storedBuffer.length
      ? crypto.timingSafeEqual(plainBuffer, storedBuffer)
      : crypto.timingSafeEqual(
          storedBuffer,
          Buffer.alloc(storedBuffer.length),
        ) && false;
  return { match, needsRehash: match };
}

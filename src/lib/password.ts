import bcryptjs from 'bcryptjs';

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

  const match = stored === plain;
  return { match, needsRehash: match };
}

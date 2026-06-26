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
      .catch(() => bcryptjs);
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
  const isBcrypt = /^\$2[ab]\$\d{2}\$.{53}$/.test(stored);

  if (isBcrypt) {
    const bcrypt = await getBcryptApi();
    const match = await bcrypt.compare(plain, stored);
    return { match, needsRehash: false };
  }

  const match = stored === plain;
  return { match, needsRehash: match };
}

import 'server-only';

import { verifySignature } from './auth.server';

const AUTH_SECRET_ENV_KEYS = ['AUTH_SECRET'] as const;
const AUTH_SIGNING_SECRET_MIN_LENGTH = 32;

function readEnvSecret(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      if (value.length < AUTH_SIGNING_SECRET_MIN_LENGTH) {
        throw new Error(`${key} 长度不能少于 32 个字符`);
      }

      return value;
    }
  }

  return null;
}

export function getConfiguredAuthSigningSecret(): string | null {
  return readEnvSecret(AUTH_SECRET_ENV_KEYS);
}

export function getAuthSigningSecret(): string {
  const secret = getConfiguredAuthSigningSecret();
  if (!secret) {
    throw new Error('AUTH_SECRET 未配置，无法生成安全签名');
  }

  return secret;
}

export async function verifyAuthSignature(
  data: string,
  signature: string,
): Promise<boolean> {
  const currentSecret = getConfiguredAuthSigningSecret();

  if (
    currentSecret &&
    (await verifySignature(data, signature, currentSecret))
  ) {
    return true;
  }

  return false;
}

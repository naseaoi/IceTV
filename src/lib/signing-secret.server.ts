import { verifySignature } from './auth.server';
import { getOwnerPassword } from './env.server';

const AUTH_SECRET_ENV_KEYS = ['AUTH_SECRET', 'ICETV_AUTH_SECRET'] as const;

type VerifyAuthSignatureOptions = {
  allowLegacyOwnerPassword?: boolean;
};

function readEnvSecret(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
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
  options: VerifyAuthSignatureOptions = {},
): Promise<boolean> {
  const currentSecret = getConfiguredAuthSigningSecret();

  if (
    currentSecret &&
    (await verifySignature(data, signature, currentSecret))
  ) {
    return true;
  }

  if (!options.allowLegacyOwnerPassword) {
    return false;
  }

  const legacySecret = getOwnerPassword();
  if (!legacySecret || legacySecret === currentSecret) {
    return false;
  }

  return verifySignature(data, signature, legacySecret);
}

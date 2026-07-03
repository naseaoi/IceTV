import 'server-only';

import { verifySignature } from './auth.server';
import { getOwnerPassword } from './env.server';

const AUTH_SECRET_ENV_KEYS = ['AUTH_SECRET', 'ICETV_AUTH_SECRET'] as const;
const DEFAULT_LEGACY_COOKIE_CUTOFF_DATE = '2026-10-01T00:00:00.000Z';
const AUTH_SIGNING_SECRET_MIN_LENGTH = 32;

type VerifyAuthSignatureOptions = {
  allowLegacyOwnerPassword?: boolean;
};

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

  if (!isLegacyOwnerPasswordSignatureAllowed()) {
    return false;
  }

  const legacySecret = getOwnerPassword();
  if (!legacySecret || legacySecret === currentSecret) {
    return false;
  }

  const legacyValid = await verifySignature(data, signature, legacySecret);
  if (legacyValid) {
    console.warn(
      '检测到使用旧站长口令验签的会话，建议尽快让用户重新登录，并用 LEGACY_COOKIE_CUTOFF_DATE 关闭兼容期',
    );
  }
  return legacyValid;
}

function isLegacyOwnerPasswordSignatureAllowed(): boolean {
  const cutoff = Date.parse(
    process.env.LEGACY_COOKIE_CUTOFF_DATE || DEFAULT_LEGACY_COOKIE_CUTOFF_DATE,
  );

  if (!Number.isFinite(cutoff)) {
    console.warn('LEGACY_COOKIE_CUTOFF_DATE 格式无效');
    return false;
  }

  return Date.now() < cutoff;
}

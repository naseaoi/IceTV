import { createHmac, timingSafeEqual } from 'crypto';

import { getAuthSigningSecret } from '@/lib/signing-secret.server';

export function signInactiveConfirmation(data: {
  before: number;
  count: number;
  operator: string;
  days: number;
}): string {
  const payload = Buffer.from(
    JSON.stringify({ ...data, expires: Date.now() + 10 * 60_000 }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', getAuthSigningSecret()).update(payload).digest('base64url')}`;
}

export function readInactiveConfirmation(
  value: unknown,
  operator: string,
  days: number,
): { before: number; count: number } {
  if (typeof value !== 'string' || value.length > 2048)
    throw new Error('请重新筛选不活跃用户');
  const [payload, signature] = value.split('.');
  const expected = createHmac('sha256', getAuthSigningSecret())
    .update(payload)
    .digest();
  const actual = Buffer.from(signature || '', 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error('请重新筛选不活跃用户');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (
    data.operator !== operator ||
    data.days !== days ||
    data.expires < Date.now()
  )
    throw new Error('请重新筛选不活跃用户');
  return data;
}

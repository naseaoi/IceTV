import 'server-only';

import type { NextRequest } from 'next/server';

function getTrustedProxyCount(): number {
  const raw = Number.parseInt(process.env.TRUSTED_PROXY_COUNT || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const trustedProxyCount = getTrustedProxyCount();

  if (trustedProxyCount > 0 && forwardedFor) {
    const parts = forwardedFor
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const index = parts.length - trustedProxyCount;
    if (index >= 0 && parts[index]) {
      return parts[index];
    }
  }

  const realIp =
    request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return 'unknown';
}

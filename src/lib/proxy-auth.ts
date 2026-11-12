import 'server-only';

import type { NextRequest, NextResponse } from 'next/server';

import { generateSignature, verifySignature } from './auth.server';
import { getAuthSigningSecret } from './signing-secret.server';

export type ProxySignaturePurpose =
  | 'image'
  | 'key'
  | 'logo'
  | 'm3u8'
  | 'segment';

export type ProxyAuthorizationResult =
  | {
      authorized: true;
      via: 'signature';
      proxyPoolStickyKey?: string;
    }
  | {
      authorized: true;
      via: 'session';
      username: string;
      proxyPoolStickyKey?: string;
    }
  | {
      authorized: false;
      response: NextResponse;
    };

const STICKY_PARAM = 'icetv-sticky';
const SIGNATURE_PARAM = 'icetv-signature';
const EXPIRES_PARAM = 'icetv-expires';
const SIGNATURE_TTL_MS = 10 * 60 * 1000;
const SIGNATURE_RE = /^[a-f0-9]{64}$/i;

function getProxySignatureExpiresAt(now: number = Date.now()): number {
  return now + SIGNATURE_TTL_MS;
}

async function signProxyTarget(
  purpose: ProxySignaturePurpose,
  targetUrl: string,
  expiresAt: number = getProxySignatureExpiresAt(),
  proxyPoolStickyKey?: string,
): Promise<{ expiresAt: number; signature: string }> {
  const signature = await generateSignature(
    getProxySignaturePayload(purpose, targetUrl, expiresAt, proxyPoolStickyKey),
    getAuthSigningSecret(),
  );

  return { expiresAt, signature };
}

export async function appendProxySignature(
  params: URLSearchParams,
  purpose: ProxySignaturePurpose,
  targetUrl: string,
  proxyPoolStickyKey?: string,
): Promise<void> {
  params.delete(STICKY_PARAM);
  if (proxyPoolStickyKey) params.set(STICKY_PARAM, proxyPoolStickyKey);
  const { expiresAt, signature } = await signProxyTarget(
    purpose,
    targetUrl,
    undefined,
    proxyPoolStickyKey,
  );
  params.set(EXPIRES_PARAM, String(expiresAt));
  params.set(SIGNATURE_PARAM, signature);
}

export async function verifyProxySignature(
  searchParams: URLSearchParams,
  purpose: ProxySignaturePurpose,
  targetUrl: string,
  now: number = Date.now(),
): Promise<boolean> {
  const signature = searchParams.get(SIGNATURE_PARAM) || '';
  const proxyPoolStickyKey = searchParams.get(STICKY_PARAM);
  if (proxyPoolStickyKey !== null && !SIGNATURE_RE.test(proxyPoolStickyKey))
    return false;
  const expiresAt = Number.parseInt(searchParams.get(EXPIRES_PARAM) || '', 10);

  if (
    !SIGNATURE_RE.test(signature) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  ) {
    return false;
  }

  try {
    return await verifySignature(
      getProxySignaturePayload(
        purpose,
        targetUrl,
        expiresAt,
        proxyPoolStickyKey ?? undefined,
      ),
      signature,
      getAuthSigningSecret(),
    );
  } catch (error) {
    console.error('代理签名密钥未配置:', error);
    return false;
  }
}

export async function authorizeProxyRequest(
  request: NextRequest,
  purpose: ProxySignaturePurpose,
  targetUrl: string,
): Promise<NextResponse | null> {
  const result = await resolveProxyAuthorization(request, purpose, targetUrl);
  return result.authorized ? null : result.response;
}

export async function resolveProxyAuthorization(
  request: NextRequest,
  purpose: ProxySignaturePurpose,
  targetUrl: string,
): Promise<ProxyAuthorizationResult> {
  const { searchParams } = new URL(request.url);
  if (await verifyProxySignature(searchParams, purpose, targetUrl)) {
    return {
      authorized: true,
      via: 'signature',
      ...(searchParams.has(STICKY_PARAM)
        ? { proxyPoolStickyKey: searchParams.get(STICKY_PARAM)! }
        : {}),
    };
  }

  const { isGuardFailure, requireActiveUser } = await import('@/lib/api-auth');
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  if (isGuardFailure(guardResult)) {
    return { authorized: false, response: guardResult.response };
  }

  return {
    authorized: true,
    via: 'session',
    username: guardResult.username,
    ...(['m3u8', 'key', 'segment'].includes(purpose) &&
    searchParams.get('icetv-live') !== '1'
      ? {
          proxyPoolStickyKey: await generateSignature(
            JSON.stringify(['proxy-pool-sticky-v1', guardResult.username]),
            getAuthSigningSecret(),
          ),
        }
      : {}),
  };
}

function getProxySignaturePayload(
  purpose: ProxySignaturePurpose,
  targetUrl: string,
  expiresAt: number,
  proxyPoolStickyKey?: string,
): string {
  return JSON.stringify([
    purpose,
    normalizeProxySignatureTarget(targetUrl),
    expiresAt,
    // 保留旧签名载荷；新上下文与目的、目标和有效期一起验签。
    ...(proxyPoolStickyKey ? [proxyPoolStickyKey] : []),
  ]);
}

function normalizeProxySignatureTarget(targetUrl: string): string {
  try {
    return decodeURIComponent(targetUrl);
  } catch {
    return targetUrl;
  }
}

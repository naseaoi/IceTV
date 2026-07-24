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
    }
  | {
      authorized: true;
      via: 'session';
      username: string;
    }
  | {
      authorized: false;
      response: NextResponse;
    };

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
): Promise<{ expiresAt: number; signature: string }> {
  const signature = await generateSignature(
    getProxySignaturePayload(purpose, targetUrl, expiresAt),
    getAuthSigningSecret(),
  );

  return { expiresAt, signature };
}

export async function appendProxySignature(
  params: URLSearchParams,
  purpose: ProxySignaturePurpose,
  targetUrl: string,
): Promise<void> {
  const { expiresAt, signature } = await signProxyTarget(purpose, targetUrl);
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
      getProxySignaturePayload(purpose, targetUrl, expiresAt),
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
    return { authorized: true, via: 'signature' };
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
  };
}

function getProxySignaturePayload(
  purpose: ProxySignaturePurpose,
  targetUrl: string,
  expiresAt: number,
): string {
  return JSON.stringify([
    purpose,
    normalizeProxySignatureTarget(targetUrl),
    expiresAt,
  ]);
}

function normalizeProxySignatureTarget(targetUrl: string): string {
  try {
    return decodeURIComponent(targetUrl);
  } catch {
    return targetUrl;
  }
}

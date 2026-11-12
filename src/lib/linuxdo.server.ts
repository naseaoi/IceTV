import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { isSecureRequest } from '@/lib/auth.server';
import { getConfigForRead, invalidateConfigCache } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import {
  releaseInviteCode,
  reserveInviteCode,
} from '@/lib/invite-code-consumption.server';
import { isLinuxDoLoginEnabled } from '@/lib/linuxdo-config.server';
import {
  type LinuxDoErrorCode,
  LINUXDO_ERROR_MESSAGES,
} from '@/lib/linuxdo-errors';
import { seedListCountCookies } from '@/lib/list-count-seed.server';
import {
  generateAuthCookie,
  recordLoginActivity,
  setAuthCookies,
} from '@/lib/login-session.server';
import type { OAuthIdentity } from '@/lib/oauth-identity';
import { readJsonLimited } from '@/lib/proxy-response-limits';
import { checkRegistrationRateLimit } from '@/lib/register.server';
import { NicknameTakenError } from '@/lib/review-social-storage';
import { getAuthSigningSecret } from '@/lib/signing-secret.server';
import { fetchUpstream } from '@/lib/upstream-fetch.server';
import { validateNickname } from '@/lib/user-profile';
import { isValidUsername, normalizeUsername } from '@/lib/username';

export const LINUXDO_SCOPE = 'openid profile';
export const LINUXDO_STATE_COOKIE = 'linuxdo_state';
export const LINUXDO_PENDING_COOKIE = 'linuxdo_pending';
const COOKIE_PATH = '/api/auth/linuxdo';
const COOKIE_SECONDS = 600;
const AUTHORIZE_URL = 'https://connect.linux.do/oauth2/authorize';
const TOKEN_URL = 'https://connect.linux.do/oauth2/token';
const USERINFO_URL = 'https://connect.linux.do/api/user';

type OAuthState = {
  state: string;
  verifier: string;
  mode: 'login' | 'bind';
  redirect: string;
  redirectUri: string;
  username?: string;
  exp: number;
};
type PendingRegistration = {
  providerUserId: string;
  providerUsername: string;
  name: string;
  trustLevel: number;
  redirect: string;
  exp: number;
};
class LinuxDoError extends Error {
  constructor(
    public code: LinuxDoErrorCode,
    public status = 400,
  ) {
    super(LINUXDO_ERROR_MESSAGES[code]);
  }
}

export function safeLinuxDoRedirect(value: string | null): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000- ]/.test(value)
  )
    return '/';
  const url = new URL(value, 'http://local');
  if (url.origin !== 'http://local' || url.pathname.startsWith('//'))
    return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

// 转发头只在部署者明确配置了可信代理时参与回调地址推导。
function publicOrigin(request: NextRequest): string {
  const requestUrl = new URL(request.url);
  const fromHost = (
    host: string | null | undefined,
    protocol: string,
  ): string | null => {
    if (
      !host ||
      /[\s/\\@?#,]/.test(host) ||
      !['http:', 'https:'].includes(protocol)
    )
      return null;
    try {
      return new URL(`${protocol}//${host}`).origin;
    } catch {
      return null;
    }
  };
  const origin =
    fromHost(request.headers.get('host'), requestUrl.protocol) ??
    requestUrl.origin;
  const proxyCount = Number(process.env.TRUSTED_PROXY_COUNT);
  if (!Number.isInteger(proxyCount) || proxyCount <= 0) return origin;
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return fromHost(host, `${proto}:`) ?? origin;
}
function callbackUri(request: NextRequest): string {
  const uri =
    process.env.LINUXDO_REDIRECT_URI?.trim() ||
    `${publicOrigin(request)}/api/auth/linuxdo/callback`;
  const url = new URL(uri);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new LinuxDoError('linuxdo_unavailable');
  return url.toString();
}
function signature(name: string, encoded: string): Buffer {
  return createHmac('sha256', getAuthSigningSecret())
    .update(`${name}:${encoded}`)
    .digest();
}
function writeCookie(
  response: NextResponse,
  request: NextRequest,
  name: string,
  value: object | null,
) {
  const encoded = value
    ? Buffer.from(JSON.stringify(value)).toString('base64url')
    : '';
  response.cookies.set(
    name,
    value ? `${encoded}.${signature(name, encoded).toString('base64url')}` : '',
    {
      path: COOKIE_PATH,
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(request),
      maxAge: value ? COOKIE_SECONDS : 0,
    },
  );
}
function readCookie<T extends { exp: number }>(
  request: NextRequest,
  name: string,
): T | null {
  const cookie = request.cookies.get(name)?.value;
  if (!cookie || cookie.length > 4096) return null;
  const [encoded, mac, extra] = cookie.split('.');
  if (!encoded || !mac || extra) return null;
  const expected = signature(name, encoded);
  const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
    return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as T;
    return payload &&
      typeof payload.exp === 'number' &&
      payload.exp > Date.now() &&
      payload.exp <= Date.now() + COOKIE_SECONDS * 1000
      ? payload
      : null;
  } catch {
    return null;
  }
}
function redirectResponse(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(
    new URL(path, publicOrigin(request)),
    302,
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
function bindRedirect(path: string, result: string): string {
  const url = new URL(safeLinuxDoRedirect(path), 'http://local');
  url.searchParams.set('linuxdo_bind', result);
  return `${url.pathname}${url.search}${url.hash}`;
}
function failure(
  request: NextRequest,
  code: LinuxDoErrorCode,
  state?: OAuthState | null,
): NextResponse {
  if (code === 'linuxdo_session_changed')
    return redirectResponse(request, '/login');
  return redirectResponse(
    request,
    state?.mode === 'bind'
      ? bindRedirect(state.redirect, code)
      : `/login?error=${code}`,
  );
}
function errorCode(error: unknown): LinuxDoErrorCode {
  if (error instanceof LinuxDoError) return error.code;
  // 上游异常可能含授权头或 URL，仅记录固定分类。
  console.error('LinuxDo 操作发生内部错误');
  return 'linuxdo_failed';
}
function jsonError(error: unknown) {
  const code = errorCode(error);
  return NextResponse.json(
    { error: LINUXDO_ERROR_MESSAGES[code], code },
    {
      status: error instanceof LinuxDoError ? error.status : 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function startLinuxDo(request: NextRequest) {
  let state: OAuthState | undefined;
  try {
    const mode =
      request.nextUrl.searchParams.get('mode') === 'bind' ? 'bind' : 'login';
    const redirect = safeLinuxDoRedirect(
      request.nextUrl.searchParams.get('redirect'),
    );
    state = {
      state: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
      mode,
      redirect,
      redirectUri: '',
      exp: Date.now() + COOKIE_SECONDS * 1000,
    };
    if (mode === 'bind') {
      const guard = await requireActiveUser(request);
      if (isGuardFailure(guard))
        throw new LinuxDoError('linuxdo_session_changed');
      if (
        guard.isOwner ||
        normalizeUsername(guard.username) ===
          normalizeUsername(getOwnerUsername())
      )
        throw new LinuxDoError('linuxdo_owner_forbidden');
      state.username = normalizeUsername(guard.username);
    }
    if (!isLinuxDoLoginEnabled(await getConfigForRead()))
      throw new LinuxDoError('linuxdo_unavailable');
    state.redirectUri = callbackUri(request);
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: process.env.LINUXDO_CLIENT_ID!.trim(),
      redirect_uri: state.redirectUri,
      response_type: 'code',
      scope: LINUXDO_SCOPE,
      state: state.state,
      code_challenge: createHash('sha256')
        .update(state.verifier)
        .digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    const response = NextResponse.redirect(url, 302);
    response.headers.set('Cache-Control', 'no-store');
    writeCookie(response, request, LINUXDO_STATE_COOKIE, state);
    writeCookie(response, request, LINUXDO_PENDING_COOKIE, null);
    return response;
  } catch (error) {
    return failure(request, errorCode(error), state);
  }
}

async function fetchProfile(
  code: string,
  state: OAuthState,
): Promise<PendingRegistration> {
  let token: unknown;
  try {
    const response = await fetchUpstream(TOKEN_URL, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${process.env.LINUXDO_CLIENT_ID!.trim()}:${process.env.LINUXDO_CLIENT_SECRET!.trim()}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: state.redirectUri,
        code_verifier: state.verifier,
      }).toString(),
    });
    if (!response.ok) throw new Error('token');
    token = await readJsonLimited(response, 64 * 1024);
  } catch {
    throw new LinuxDoError('linuxdo_token_failed');
  }
  if (
    !token ||
    typeof token !== 'object' ||
    !('access_token' in token) ||
    typeof token.access_token !== 'string' ||
    !token.access_token ||
    token.access_token.length > 8192 ||
    /[\r\n]/.test(token.access_token)
  )
    throw new LinuxDoError('linuxdo_token_failed');
  let user: Record<string, unknown>;
  try {
    const response = await fetchUpstream(USERINFO_URL, {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok) throw new Error('userinfo');
    user = await readJsonLimited(response, 64 * 1024);
  } catch {
    throw new LinuxDoError('linuxdo_profile_failed');
  }
  if (
    !user ||
    typeof user !== 'object' ||
    !(
      (typeof user.id === 'number' &&
        Number.isSafeInteger(user.id) &&
        user.id > 0) ||
      (typeof user.id === 'string' &&
        user.id.length > 0 &&
        user.id.length <= 191 &&
        user.id.trim() === user.id &&
        !/[\u0000-\u001f]/.test(user.id))
    ) ||
    typeof user.username !== 'string' ||
    !user.username.trim() ||
    user.username.length > 191 ||
    typeof user.trust_level !== 'number' ||
    !Number.isInteger(user.trust_level) ||
    user.trust_level < 0 ||
    user.trust_level > 4
  )
    throw new LinuxDoError('linuxdo_profile_failed');
  if (user.active === undefined)
    console.warn('LinuxDo 用户信息缺少 active 字段，按兼容策略允许登录');
  if (user.active === false) throw new LinuxDoError('linuxdo_inactive', 403);
  return {
    providerUserId: String(user.id),
    providerUsername: user.username,
    name: typeof user.name === 'string' ? user.name.slice(0, 128) : '',
    trustLevel: user.trust_level,
    redirect: state.redirect,
    exp: Date.now() + COOKIE_SECONDS * 1000,
  };
}
function identity(
  profile: PendingRegistration,
  username: string,
): OAuthIdentity {
  return {
    provider: 'linuxdo',
    providerUserId: profile.providerUserId,
    providerUsername: profile.providerUsername,
    username,
    autoCreated: true,
    createdAt: Date.now(),
  };
}
async function attachSession(
  response: NextResponse,
  request: NextRequest,
  username: string,
) {
  if (normalizeUsername(username) === normalizeUsername(getOwnerUsername()))
    throw new LinuxDoError('linuxdo_owner_forbidden', 403);
  const access = await db.getUserAccess(username);
  if (!access || !(await db.checkUserExist(username)))
    throw new LinuxDoError('linuxdo_user_missing', 403);
  if (access.banned) throw new LinuxDoError('linuxdo_banned', 403);
  setAuthCookies(
    response,
    request,
    await generateAuthCookie(
      access.role === 'admin' ? 'admin' : 'user',
      username,
    ),
  );
  await Promise.all([
    recordLoginActivity(username),
    seedListCountCookies(response, username),
  ]);
}
async function createAccount(
  request: NextRequest,
  profile: PendingRegistration,
  inviteCode?: string,
): Promise<string> {
  const rate = checkRegistrationRateLimit(request);
  if (!rate.allowed) throw new LinuxDoError('linuxdo_rate_limited', 429);
  const config = await getConfigForRead();
  if (!isLinuxDoLoginEnabled(config))
    throw new LinuxDoError('linuxdo_unavailable', 403);
  if (profile.trustLevel < (config.UserConfig.LinuxDo?.MinTrustLevel ?? 1))
    throw new LinuxDoError('linuxdo_trust_level', 403);
  if (!config.UserConfig.OpenRegister)
    throw new LinuxDoError('linuxdo_not_bound', 403);
  if (await db.getOAuthIdentity(profile.providerUserId))
    throw new LinuxDoError('linuxdo_identity_taken', 409);
  const reserved = config.UserConfig.RequireInviteCode
    ? await reserveInviteCode(inviteCode)
    : false;
  if (config.UserConfig.RequireInviteCode && !reserved)
    throw new LinuxDoError('linuxdo_invite_invalid', 403);
  try {
    const raw = normalizeUsername(profile.providerUsername);
    const base = raw.replace(/[^a-z0-9._-]/g, '').slice(0, 58) || 'user';
    let nickname: string | undefined;
    try {
      nickname = validateNickname(
        profile.name || profile.providerUsername,
      ).nickname;
    } catch {
      nickname = undefined;
    }
    const password = randomBytes(32).toString('base64url');
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate =
        attempt === 0 ? raw : `${base}_ld${attempt === 1 ? '' : attempt}`;
      if (
        !isValidUsername(candidate) ||
        candidate === normalizeUsername(getOwnerUsername()) ||
        (await db.checkUserExist(candidate))
      )
        continue;
      try {
        const register = () =>
          db.registerUser(
            candidate,
            password,
            nickname,
            config.UserConfig.DefaultUserGroup
              ? [config.UserConfig.DefaultUserGroup]
              : undefined,
            identity(profile, candidate),
          );
        try {
          await register();
        } catch (error) {
          if (!(error instanceof NicknameTakenError)) throw error;
          nickname = undefined;
          await register();
        }
        invalidateConfigCache();
        return candidate;
      } catch (error) {
        if (await db.getOAuthIdentity(profile.providerUserId))
          throw new LinuxDoError('linuxdo_identity_taken', 409);
        if (await db.checkUserExist(candidate)) continue;
        throw error;
      }
    }
    throw new LinuxDoError('linuxdo_register_failed', 409);
  } catch (error) {
    if (reserved) await releaseInviteCode(inviteCode);
    throw error;
  }
}

export async function callbackLinuxDo(request: NextRequest) {
  let state: OAuthState | null = null;
  let response: NextResponse;
  try {
    state = readCookie<OAuthState>(request, LINUXDO_STATE_COOKIE);
    if (!state || state.state !== request.nextUrl.searchParams.get('state'))
      throw new LinuxDoError('linuxdo_invalid_state');
    if (state.mode === 'bind') {
      const guard = await requireActiveUser(request);
      if (
        isGuardFailure(guard) ||
        normalizeUsername(guard.username) !== state.username
      )
        throw new LinuxDoError('linuxdo_session_changed');
      if (
        guard.isOwner ||
        state.username === normalizeUsername(getOwnerUsername())
      )
        throw new LinuxDoError('linuxdo_owner_forbidden');
    }
    const config = await getConfigForRead();
    if (!isLinuxDoLoginEnabled(config))
      throw new LinuxDoError('linuxdo_unavailable');
    if (request.nextUrl.searchParams.has('error'))
      throw new LinuxDoError('linuxdo_access_denied');
    const code = request.nextUrl.searchParams.get('code');
    if (!code || code.length > 4096)
      throw new LinuxDoError('linuxdo_token_failed');
    const profile = await fetchProfile(code, state);
    if (profile.trustLevel < (config.UserConfig.LinuxDo?.MinTrustLevel ?? 1))
      throw new LinuxDoError('linuxdo_trust_level', 403);
    if (state.mode === 'bind') {
      const result = await db.bindOAuthIdentity({
        ...identity(profile, state.username!),
        autoCreated: false,
      });
      if (result !== 'bound') throw new LinuxDoError(`linuxdo_${result}`, 409);
      await db.updateOAuthProviderUsername(
        profile.providerUserId,
        profile.providerUsername,
      );
      response = redirectResponse(request, bindRedirect(state.redirect, 'ok'));
    } else {
      const existing = await db.getOAuthIdentity(profile.providerUserId);
      if (existing) {
        response = redirectResponse(
          request,
          safeLinuxDoRedirect(state.redirect),
        );
        await attachSession(response, request, existing.username);
        await db.updateOAuthProviderUsername(
          profile.providerUserId,
          profile.providerUsername,
        );
      } else {
        if (!config.UserConfig.OpenRegister)
          throw new LinuxDoError('linuxdo_not_bound', 403);
        if (config.UserConfig.RequireInviteCode) {
          response = redirectResponse(request, '/login?linuxdo=invite');
          writeCookie(response, request, LINUXDO_PENDING_COOKIE, profile);
        } else {
          const username = await createAccount(request, profile);
          response = redirectResponse(
            request,
            safeLinuxDoRedirect(state.redirect),
          );
          await attachSession(response, request, username);
        }
      }
    }
  } catch (error) {
    response = failure(request, errorCode(error), state);
  }
  writeCookie(response, request, LINUXDO_STATE_COOKIE, null);
  return response;
}

export async function getLinuxDoPending(request: NextRequest) {
  try {
    if (!isLinuxDoLoginEnabled(await getConfigForRead()))
      throw new LinuxDoError('linuxdo_unavailable', 403);
    const pending = readCookie<PendingRegistration>(
      request,
      LINUXDO_PENDING_COOKIE,
    );
    if (!pending) throw new LinuxDoError('linuxdo_invalid_state', 404);
    return NextResponse.json(
      { providerUsername: pending.providerUsername },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
function checkSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (origin && origin !== publicOrigin(request))
  )
    throw new LinuxDoError('linuxdo_request_invalid', 403);
}
export async function registerLinuxDo(request: NextRequest) {
  try {
    checkSameOrigin(request);
    const pending = readCookie<PendingRegistration>(
      request,
      LINUXDO_PENDING_COOKIE,
    );
    if (!pending) throw new LinuxDoError('linuxdo_invalid_state');
    let body: { inviteCode?: unknown };
    try {
      body = await request.json();
    } catch {
      throw new LinuxDoError('linuxdo_request_invalid');
    }
    if (
      !body ||
      typeof body.inviteCode !== 'string' ||
      body.inviteCode.length > 128
    )
      throw new LinuxDoError('linuxdo_request_invalid');
    const username = await createAccount(request, pending, body.inviteCode);
    const response = NextResponse.json(
      { ok: true, redirect: safeLinuxDoRedirect(pending.redirect) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    await attachSession(response, request, username);
    writeCookie(response, request, LINUXDO_PENDING_COOKIE, null);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
export async function getLinuxDoBinding(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const binding = await db.getUserOAuthIdentity(guard.username);
    return NextResponse.json(
      {
        bound: !!binding,
        providerUsername: binding?.providerUsername ?? null,
        canUnbind: !!binding && !binding.autoCreated,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
export async function deleteLinuxDoBinding(request: NextRequest) {
  try {
    checkSameOrigin(request);
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const binding = await db.getUserOAuthIdentity(guard.username);
    if (binding?.autoCreated)
      throw new LinuxDoError('linuxdo_auto_created', 403);
    if (binding && !(await db.unbindOAuthIdentity(guard.username)))
      throw new LinuxDoError('linuxdo_auto_created', 409);
    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

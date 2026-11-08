/** @jest-environment node */
import { createHmac } from 'crypto';
import type { NextRequest } from 'next/server';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

installCryptoPolyfill();
installStreamPolyfills();

const mockConfig = {
  UserConfig: {
    LinuxDo: { Enabled: true, MinTrustLevel: 1 },
    OpenRegister: true,
    RequireInviteCode: false,
    DefaultUserGroup: 'members',
  },
};
const mockDb = {
  getOAuthIdentity: jest.fn(),
  getUserOAuthIdentity: jest.fn(),
  bindOAuthIdentity: jest.fn(),
  unbindOAuthIdentity: jest.fn(),
  updateOAuthProviderUsername: jest.fn(),
  getUserAccess: jest.fn(),
  checkUserExist: jest.fn(),
  registerUser: jest.fn(),
  recordUserActivity: jest.fn(),
  reserveInviteCodeUse: jest.fn(),
  releaseInviteCodeUse: jest.fn(),
};
const mockFetch = jest.fn();
const mockReadJson = jest.fn();
const mockGuard = jest.fn();
const mockRate = jest.fn();
jest.mock('@/lib/db', () => ({ db: mockDb }));
jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => mockConfig,
  invalidateConfigCache: jest.fn(),
}));
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (value: object) => 'response' in value,
}));
jest.mock('@/lib/register.server', () => ({
  checkRegistrationRateLimit: (...args: unknown[]) => mockRate(...args),
}));
jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/lib/proxy-response-limits', () => ({
  readJsonLimited: (...args: unknown[]) => mockReadJson(...args),
}));
jest.mock('@/lib/env.server', () => ({ getOwnerUsername: () => 'owner' }));
const start = require('./route') as typeof import('./route');
const callback =
  require('./callback/route') as typeof import('./callback/route');
const register =
  require('./register/route') as typeof import('./register/route');
const binding = require('./binding/route') as typeof import('./binding/route');
const secret = 'linuxdo-unit-test-signing-secret-32-characters';
function req(
  path: string,
  cookies: Record<string, string> = {},
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const url = new URL(path, 'http://localhost');
  return {
    url: url.toString(),
    nextUrl: url,
    cookies: {
      get: (name: string) =>
        cookies[name] ? { value: cookies[name] } : undefined,
    },
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as NextRequest;
}
function signed(name: string, payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(`${name}:${encoded}`).digest('base64url')}`;
}
const pending = () =>
  signed('linuxdo_pending', {
    providerUserId: '123',
    providerUsername: 'Alice',
    name: 'Alice',
    trustLevel: 2,
    redirect: '/favorites',
    exp: Date.now() + 600_000,
  });
async function flow(query = '') {
  const response = await start.GET(req(`/api/auth/linuxdo${query}`));
  const location = new URL(response.headers.get('location')!);
  return {
    state: location.searchParams.get('state')!,
    cookie: response.cookies.get('linuxdo_state')!.value,
  };
}
async function finish(query = '', profile: Record<string, unknown> = {}) {
  const { state, cookie } = await flow(query);
  mockReadJson
    .mockResolvedValueOnce({ access_token: 'test-access-token' })
    .mockResolvedValueOnce({
      id: 123,
      username: 'Alice',
      name: 'Alice',
      active: true,
      trust_level: 2,
      silenced: false,
      ...profile,
    });
  return callback.GET(
    req(`/api/auth/linuxdo/callback?state=${state}&code=test-code`, {
      linuxdo_state: cookie,
    }),
  );
}
function expectError(response: Response, code: string) {
  expect(response.status).toBe(302);
  expect(
    new URL(response.headers.get('location')!).searchParams.get('error'),
  ).toBe(code);
}
describe('LinuxDo 路由', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.AUTH_SECRET = secret;
    process.env.LINUXDO_CLIENT_ID = 'test-client';
    process.env.LINUXDO_CLIENT_SECRET = 'test-secret';
    delete process.env.LINUXDO_REDIRECT_URI;
    delete process.env.TRUSTED_PROXY_COUNT;
    mockConfig.UserConfig.LinuxDo = { Enabled: true, MinTrustLevel: 1 };
    mockConfig.UserConfig.OpenRegister = true;
    mockConfig.UserConfig.RequireInviteCode = false;
    mockDb.getOAuthIdentity.mockResolvedValue(null);
    mockDb.getUserOAuthIdentity.mockResolvedValue(null);
    mockDb.getUserAccess.mockResolvedValue({ role: 'user', banned: false });
    mockDb.checkUserExist.mockResolvedValue(true);
    mockDb.bindOAuthIdentity.mockResolvedValue('bound');
    mockDb.unbindOAuthIdentity.mockResolvedValue(true);
    mockDb.reserveInviteCodeUse.mockResolvedValue(true);
    mockGuard.mockResolvedValue({
      username: 'localuser',
      role: 'user',
      isOwner: false,
    });
    mockRate.mockReturnValue({ allowed: true });
    mockFetch.mockResolvedValue({ ok: true });
  });
  it('禁用时拒绝发起', async () => {
    mockConfig.UserConfig.LinuxDo.Enabled = false;
    expectError(
      await start.GET(req('/api/auth/linuxdo')),
      'linuxdo_unavailable',
    );
  });
  it('环境变量不全时拒绝发起', async () => {
    delete process.env.LINUXDO_CLIENT_SECRET;
    expectError(
      await start.GET(req('/api/auth/linuxdo')),
      'linuxdo_unavailable',
    );
  });
  it('state 和 PKCE cookie 安全属性完整', async () => {
    const response = await start.GET(req('/api/auth/linuxdo'));
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(response.cookies.get('linuxdo_state')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth/linuxdo',
      maxAge: 600,
    });
  });
  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    '/\nevil',
  ])('拦截开放跳转 %s', async (redirect) => {
    mockDb.getOAuthIdentity.mockResolvedValue({ username: 'localuser' });
    const response = await finish(`?redirect=${encodeURIComponent(redirect)}`);
    expect(response.headers.get('location')).toBe('http://localhost/');
  });
  it.each(['tamper', 'expired', 'mismatch'])(
    '拒绝无效 state 并清 cookie：%s',
    async (kind) => {
      const { state, cookie } = await flow();
      const invalid =
        kind === 'tamper'
          ? `${cookie}x`
          : kind === 'expired'
            ? signed('linuxdo_state', { state, exp: Date.now() - 1 })
            : cookie;
      const response = await callback.GET(
        req(
          `/api/auth/linuxdo/callback?state=${kind === 'mismatch' ? 'wrong' : state}&code=test`,
          { linuxdo_state: invalid },
        ),
      );
      expectError(response, 'linuxdo_invalid_state');
      expect(response.cookies.get('linuxdo_state')?.maxAge).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it('授权拒绝不调用上游', async () => {
    const { state, cookie } = await flow();
    expectError(
      await callback.GET(
        req(`/api/auth/linuxdo/callback?state=${state}&error=access_denied`, {
          linuxdo_state: cookie,
        }),
      ),
      'linuxdo_access_denied',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('令牌错误转换为固定文案', async () => {
    mockFetch.mockRejectedValue(new Error('sensitive token detail'));
    expectError(await finish(), 'linuxdo_token_failed');
  });
  it.each([
    [{ trust_level: 0 }, 'linuxdo_trust_level'],
    [{ active: false }, 'linuxdo_inactive'],
    [{ id: null }, 'linuxdo_profile_failed'],
  ])('校验用户信息 %o', async (profile, code) => {
    expectError(await finish('', profile), code);
  });
  it('兼容缺失 active 与 silenced，不以 silenced 限制登录', async () => {
    mockDb.getOAuthIdentity.mockResolvedValue({ username: 'localuser' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await finish('', {
      active: undefined,
      silenced: true,
      id: 'opaque-id',
    });
    expect(response.cookies.get('auth')).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('注册关闭时仅接受已有绑定', async () => {
    mockConfig.UserConfig.OpenRegister = false;
    expectError(await finish(), 'linuxdo_not_bound');
    mockDb.getOAuthIdentity.mockResolvedValue({ username: 'localuser' });
    const response = await finish('?redirect=%2Ffavorites');
    expect(response.cookies.get('auth')).toBeDefined();
    expect(mockDb.recordUserActivity).toHaveBeenCalledWith(
      'localuser',
      expect.any(Number),
    );
    expect(mockDb.updateOAuthProviderUsername).toHaveBeenCalledWith(
      '123',
      'Alice',
    );
  });
  it('被封禁账号没有登录会话', async () => {
    mockDb.getOAuthIdentity.mockResolvedValue({ username: 'localuser' });
    mockDb.getUserAccess.mockResolvedValue({ role: 'user', banned: true });
    const response = await finish();
    expectError(response, 'linuxdo_banned');
    expect(response.cookies.get('auth')).toBeUndefined();
  });
  it('自动建号保留同名旧账号并使用后缀和默认组', async () => {
    let created = false;
    mockDb.checkUserExist.mockImplementation(
      async (username: string) => username === 'alice' || created,
    );
    mockDb.registerUser.mockImplementation(async () => {
      created = true;
    });
    const response = await finish();
    expect(mockDb.registerUser).toHaveBeenCalledWith(
      'alice_ld',
      expect.any(String),
      'Alice',
      ['members'],
      expect.objectContaining({ providerUserId: '123', autoCreated: true }),
    );
    expect(mockDb.registerUser.mock.calls[0][1]).toHaveLength(43);
    expect(response.cookies.get('auth')).toBeDefined();
  });
  it('邀请码分支可读取待注册用户名', async () => {
    mockConfig.UserConfig.RequireInviteCode = true;
    const response = await finish();
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?linuxdo=invite',
    );
    const cookie = response.cookies.get('linuxdo_pending')!.value;
    expect(
      await (
        await register.GET(
          req('/api/auth/linuxdo/register', { linuxdo_pending: cookie }),
        )
      ).json(),
    ).toEqual({ providerUsername: 'Alice' });
    expect((await register.GET(req('/api/auth/linuxdo/register'))).status).toBe(
      404,
    );
  });
  it('邀请码失败不建号也不释放未占用名额', async () => {
    mockConfig.UserConfig.RequireInviteCode = true;
    mockDb.reserveInviteCodeUse.mockResolvedValue(false);
    const response = await register.POST(
      req(
        '/api/auth/linuxdo/register',
        { linuxdo_pending: pending() },
        { inviteCode: 'test-code' },
      ),
    );
    expect(response.status).toBe(403);
    expect(mockDb.registerUser).not.toHaveBeenCalled();
    expect(mockDb.releaseInviteCodeUse).not.toHaveBeenCalled();
  });
  it('已占用邀请码在建号失败时释放', async () => {
    mockConfig.UserConfig.RequireInviteCode = true;
    mockDb.checkUserExist.mockResolvedValue(false);
    mockDb.registerUser.mockRejectedValue(new Error('database failure'));
    const response = await register.POST(
      req(
        '/api/auth/linuxdo/register',
        { linuxdo_pending: pending() },
        { inviteCode: 'test-code' },
      ),
    );
    expect(response.status).toBe(500);
    expect(mockDb.releaseInviteCodeUse).toHaveBeenCalledTimes(1);
  });
  it('规范化后的双斜线绑定回跳仍保持同站', async () => {
    const response = await finish(
      '?mode=bind&redirect=' + encodeURIComponent('/a/..//evil.example'),
    );
    expect(response.headers.get('location')).toBe(
      'http://localhost/?linuxdo_bind=ok',
    );
  });
  it('仅可信代理转发头参与回调地址', async () => {
    const headers = {
      'x-forwarded-host': 'public.example',
      'x-forwarded-proto': 'https',
    };
    const first = await start.GET(
      req('/api/auth/linuxdo', {}, undefined, headers),
    );
    expect(
      new URL(first.headers.get('location')!).searchParams.get('redirect_uri'),
    ).toBe('http://localhost/api/auth/linuxdo/callback');
    process.env.TRUSTED_PROXY_COUNT = '1';
    const second = await start.GET(
      req('/api/auth/linuxdo', {}, undefined, headers),
    );
    expect(
      new URL(second.headers.get('location')!).searchParams.get('redirect_uri'),
    ).toBe('https://public.example/api/auth/linuxdo/callback');
  });
  it('监听通配地址时使用合法 Host 生成回调与校验 POST Origin', async () => {
    const headers = { host: 'localhost:3000', origin: 'http://localhost:3000' };
    const response = await start.GET(
      req('http://0.0.0.0:3000/api/auth/linuxdo', {}, undefined, headers),
    );
    expect(
      new URL(response.headers.get('location')!).searchParams.get(
        'redirect_uri',
      ),
    ).toBe('http://localhost:3000/api/auth/linuxdo/callback');
    mockDb.checkUserExist.mockResolvedValueOnce(false).mockResolvedValue(true);
    const registered = await register.POST(
      req(
        'http://0.0.0.0:3000/api/auth/linuxdo/register',
        { linuxdo_pending: pending() },
        { inviteCode: 'test-code' },
        headers,
      ),
    );
    expect(registered.status).toBe(200);
    expect(await registered.json()).toEqual({
      ok: true,
      redirect: '/favorites',
    });
  });
  it('非法 Host 回退请求地址', async () => {
    const response = await start.GET(
      req('/api/auth/linuxdo', {}, undefined, { host: 'evil.example/path' }),
    );
    expect(
      new URL(response.headers.get('location')!).searchParams.get(
        'redirect_uri',
      ),
    ).toBe('http://localhost/api/auth/linuxdo/callback');
  });
  it('注册提交复核开关、信任级别与限流', async () => {
    const request = () =>
      req(
        '/api/auth/linuxdo/register',
        { linuxdo_pending: pending() },
        { inviteCode: 'test' },
      );
    mockConfig.UserConfig.OpenRegister = false;
    expect((await register.POST(request())).status).toBe(403);
    mockConfig.UserConfig.OpenRegister = true;
    mockConfig.UserConfig.LinuxDo.MinTrustLevel = 4;
    expect((await register.POST(request())).status).toBe(403);
    mockRate.mockReturnValue({ allowed: false });
    expect((await register.POST(request())).status).toBe(429);
    expect(mockDb.reserveInviteCodeUse).not.toHaveBeenCalled();
  });
  it('邀请码注册成功签发会话并清理待注册 cookie', async () => {
    mockConfig.UserConfig.RequireInviteCode = true;
    mockDb.checkUserExist.mockResolvedValueOnce(false).mockResolvedValue(true);
    const response = await register.POST(
      req(
        '/api/auth/linuxdo/register',
        { linuxdo_pending: pending() },
        { inviteCode: 'test-code' },
      ),
    );
    expect(await response.json()).toEqual({ ok: true, redirect: '/favorites' });
    expect(response.cookies.get('linuxdo_pending')?.maxAge).toBe(0);
    expect(response.cookies.get('auth')).toBeDefined();
  });
  it.each(['identity_taken', 'user_bound'])(
    '绑定冲突回原页面：%s',
    async (result) => {
      mockDb.bindOAuthIdentity.mockResolvedValue(result);
      const response = await finish(
        '?mode=bind&redirect=%2F%3Fpanel%3Dsettings',
      );
      const url = new URL(response.headers.get('location')!);
      expect(url.searchParams.get('panel')).toBe('settings');
      expect(url.searchParams.get('linuxdo_bind')).toBe(`linuxdo_${result}`);
    },
  );
  it('站长拒绝绑定并回设置页', async () => {
    mockGuard.mockResolvedValue({ username: 'owner', isOwner: true });
    const response = await start.GET(req('/api/auth/linuxdo?mode=bind'));
    expect(
      new URL(response.headers.get('location')!).searchParams.get(
        'linuxdo_bind',
      ),
    ).toBe('linuxdo_owner_forbidden');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('绑定成功回原页面且不重发会话', async () => {
    const response = await finish('?mode=bind&redirect=%2Ffavorites');
    expect(response.headers.get('location')).toBe(
      'http://localhost/favorites?linuxdo_bind=ok',
    );
    expect(response.cookies.get('auth')).toBeUndefined();
  });
  it('绑定回调会话变更时回登录页', async () => {
    const { state, cookie } = await flow('?mode=bind');
    mockGuard.mockResolvedValue({ username: 'otheruser', isOwner: false });
    const response = await callback.GET(
      req(`/api/auth/linuxdo/callback?state=${state}&code=test`, {
        linuxdo_state: cookie,
      }),
    );
    expect(response.headers.get('location')).toBe('http://localhost/login');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('绑定查询与 auto_created 解绑保护', async () => {
    mockDb.getUserOAuthIdentity.mockResolvedValue({
      providerUsername: 'Alice',
      autoCreated: true,
    });
    expect(
      await (await binding.GET(req('/api/auth/linuxdo/binding'))).json(),
    ).toEqual({ bound: true, providerUsername: 'Alice', canUnbind: false });
    const response = await binding.DELETE(req('/api/auth/linuxdo/binding'));
    expect(response.status).toBe(403);
    expect(mockDb.unbindOAuthIdentity).not.toHaveBeenCalled();
  });
  it('已有密码账号可以解绑', async () => {
    mockDb.getUserOAuthIdentity.mockResolvedValue({ autoCreated: false });
    expect(
      await (await binding.DELETE(req('/api/auth/linuxdo/binding'))).json(),
    ).toEqual({ ok: true });
    expect(mockDb.unbindOAuthIdentity).toHaveBeenCalledWith('localuser');
  });
  it('跨站注册与解绑请求被拒绝', async () => {
    expect(
      (
        await register.POST(
          req(
            '/api/auth/linuxdo/register',
            { linuxdo_pending: pending() },
            { inviteCode: 'test' },
            { origin: 'https://evil.example' },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await binding.DELETE(
          req('/api/auth/linuxdo/binding', {}, undefined, {
            'sec-fetch-site': 'cross-site',
          }),
        )
      ).status,
    ).toBe(403);
  });
});

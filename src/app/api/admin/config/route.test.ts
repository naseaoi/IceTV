/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireAdmin } from '@/lib/api-auth';
import { getConfigFresh } from '@/lib/config';

jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  isGuardFailure: (value: object) => 'response' in value,
}));
jest.mock('@/lib/config', () => ({ getConfigFresh: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    getLiveSourceChannelCounts: jest.fn().mockResolvedValue({}),
    getConfigSubscription: jest.fn().mockResolvedValue({}),
    countAnnouncements: jest.fn().mockResolvedValue(0),
    getAdminUserPage: jest.fn().mockResolvedValue({ total: 0 }),
    countInviteCodes: jest.fn().mockResolvedValue(0),
    countActiveInviteCodes: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('@/lib/env.server', () => ({ getOwnerUsername: () => 'owner' }));
jest.mock('@/lib/upstream-proxy-pool.server', () => ({
  isUpstreamProxyPoolConfigured: () => false,
}));
installWebPolyfills();

describe('后台配置凭证脱敏', () => {
  it.each(['owner', 'admin'])(
    '%s 响应不回显 secret，也不修改共享冻结配置',
    async (role) => {
      const linuxDo = Object.freeze({
        Enabled: true,
        MinTrustLevel: 1,
        ClientId: 'client',
        ClientSecret: 'stored-secret',
        RedirectUri: '',
      });
      const config = Object.freeze({
        SiteConfig: Object.freeze({}),
        UserConfig: Object.freeze({ LinuxDo: linuxDo }),
      });
      (requireAdmin as jest.Mock).mockResolvedValue({
        username: role,
        isOwner: role === 'owner',
      });
      (getConfigFresh as jest.Mock).mockResolvedValue(config);
      const { GET } = require('./route');
      const response = await GET({} as NextRequest);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.Config.UserConfig.LinuxDo).toEqual({
        ...linuxDo,
        ClientSecret: '',
      });
      expect(data.Config.UserConfig.LinuxDoConfigured).toBe(true);
      expect(JSON.stringify(data)).not.toContain('stored-secret');
      expect(config.UserConfig.LinuxDo.ClientSecret).toBe('stored-secret');
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );
  it('缺少任一凭证时报告未配置', async () => {
    (requireAdmin as jest.Mock).mockResolvedValue({
      username: 'owner',
      isOwner: true,
    });
    (getConfigFresh as jest.Mock).mockResolvedValue({
      SiteConfig: {},
      UserConfig: { LinuxDo: { ClientId: 'client', ClientSecret: '' } },
    });
    const { GET } = require('./route');
    expect(
      (await (await GET({} as NextRequest)).json()).Config.UserConfig
        .LinuxDoConfigured,
    ).toBe(false);
  });
});

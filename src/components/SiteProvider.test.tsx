import { render, waitFor } from '@testing-library/react';

import { SiteProvider } from '@/components/SiteProvider';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  applyClientServerConfig,
  fetchClientServerConfig,
} from '@/lib/runtime-config';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(),
}));

jest.mock('@/lib/runtime-config', () => ({
  applyClientServerConfig: jest.fn(),
  fetchClientServerConfig: jest.fn(),
}));

const mockGetAuthInfo = getAuthInfoFromBrowserCookie as jest.Mock;
const mockFetchClientServerConfig = fetchClientServerConfig as jest.Mock;
const mockApplyClientServerConfig = applyClientServerConfig as jest.Mock;

const baseProps = {
  siteName: 'IceTV',
  siteIcon: '',
  announcement: '公告',
  footerText: '页脚',
};

describe('SiteProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.__runtimeConfigReady = false;
  });

  it('游客直接使用根布局注入的运行时配置', async () => {
    mockGetAuthInfo.mockReturnValue(null);

    render(
      <SiteProvider {...baseProps}>
        <div>内容</div>
      </SiteProvider>,
    );

    await waitFor(() => {
      expect(window.__runtimeConfigReady).toBe(true);
    });
    expect(mockFetchClientServerConfig).not.toHaveBeenCalled();
  });

  it('登录用户仍拉取受保护运行时配置', async () => {
    mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'user' });
    mockFetchClientServerConfig.mockResolvedValue({
      SiteName: '新站点',
      SiteIcon: '',
      Announcement: '新公告',
      FooterText: '新页脚',
    });

    render(
      <SiteProvider {...baseProps}>
        <div>内容</div>
      </SiteProvider>,
    );

    await waitFor(() => {
      expect(mockFetchClientServerConfig).toHaveBeenCalledTimes(1);
    });
    expect(mockApplyClientServerConfig).toHaveBeenCalledTimes(1);
  });
});

import { act, render, screen, waitFor } from '@testing-library/react';

import { SiteProvider, useSite } from '@/components/SiteProvider';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { syncClientConfigAfterSave } from '@/lib/runtime-config';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(),
}));

const mockGetAuthInfo = getAuthInfoFromBrowserCookie as jest.Mock;
const originalFetch = global.fetch;
const mockFetch = jest.fn();

const baseProps = {
  siteName: 'IceTV',
  siteIcon: '',
  announcement: '公告',
  footerText: '页脚',
};

function SiteDetails() {
  const site = useSite();
  return <output>{JSON.stringify(site)}</output>;
}

function respond(data: Record<string, unknown>) {
  return { ok: true, json: async () => data };
}

describe('SiteProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    window.__runtimeConfigReady = false;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete window.RUNTIME_CONFIG;
    delete window.__runtimeConfigReady;
    document.head
      .querySelectorAll('link[data-test-icon]')
      .forEach((link) => link.remove());
  });

  it('游客直接使用根布局注入的运行时配置', async () => {
    mockGetAuthInfo.mockReturnValue(null);

    render(
      <SiteProvider {...baseProps}>
        <SiteDetails />
      </SiteProvider>,
    );

    await waitFor(() => expect(window.__runtimeConfigReady).toBe(true));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('IceTV');
  });

  it('登录用户挂载与保存后通过同一更新路径同步站点信息', async () => {
    mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'owner' });
    mockFetch.mockResolvedValueOnce(respond({ SiteName: '初始站点' }));
    for (const rel of ['icon', 'apple-touch-icon']) {
      const link = document.createElement('link');
      link.rel = rel;
      link.dataset.testIcon = '';
      document.head.appendChild(link);
    }
    render(
      <SiteProvider {...baseProps}>
        <SiteDetails />
      </SiteProvider>,
    );
    await waitFor(() => expect(document.title).toBe('初始站点'));

    mockFetch.mockResolvedValueOnce(
      respond({
        SiteName: '新站点',
        SiteIcon: '/api/site-icon',
        Announcement: '新公告',
        FooterText: '新页脚',
        EnableLiveEntry: true,
      }),
    );
    await act(async () => {
      await syncClientConfigAfterSave();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('新站点');
    expect(screen.getByRole('status')).toHaveTextContent('新公告');
    expect(screen.getByRole('status')).toHaveTextContent('新页脚');
    expect(document.title).toBe('新站点');
    for (const rel of ['icon', 'apple-touch-icon']) {
      expect(
        document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`)?.href,
      ).toContain('/api/site-icon');
    }
    expect(window.RUNTIME_CONFIG?.ENABLE_LIVE_ENTRY).toBe(true);

    mockFetch.mockResolvedValueOnce(
      respond({ SiteName: '新站点', SiteIcon: '', Announcement: '' }),
    );
    await act(async () => {
      await syncClientConfigAfterSave();
    });
    expect(
      JSON.parse(screen.getByRole('status').textContent || '{}').announcement,
    ).toBe(baseProps.announcement);
    expect(
      document.querySelector<HTMLLinkElement>("link[rel='icon']")?.href,
    ).toContain('/favicon.ico');
  });
});

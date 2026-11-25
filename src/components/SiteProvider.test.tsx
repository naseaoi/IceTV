import { act, render, screen, waitFor } from '@testing-library/react';

import { SiteProvider, useSite } from '@/components/SiteProvider';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  invalidateClientServerConfig,
  SERVER_CONFIG_INVALIDATION_SOURCE,
  syncClientConfigAfterSave,
} from '@/lib/runtime-config';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => {
    const auth = getAuthInfoFromBrowserCookie();
    return {
      session: auth
        ? { status: 'authenticated', ...auth }
        : { status: 'guest' },
    };
  },
}));

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
    invalidateClientServerConfig();
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

  it('可见页在五分钟内复用成功结果，过期自动刷新', async () => {
    jest.useFakeTimers();
    try {
      mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'owner' });
      mockFetch.mockResolvedValue(respond({ SiteName: '初始站点' }));
      const view = render(
        <SiteProvider {...baseProps}>
          <SiteDetails />
        </SiteProvider>,
      );
      await act(async () => {});
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(240_000);
        window.dispatchEvent(new Event('focus'));
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      mockFetch.mockResolvedValue(respond({ SiteName: '远程保存' }));
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(document.title).toBe('远程保存');
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('收到跨标签失效通知立即刷新，隐藏时等恢复可见', async () => {
    const original = global.BroadcastChannel;
    let receive!: (event: { data: { type: string; source?: number } }) => void;
    const close = jest.fn();
    Object.defineProperty(global, 'BroadcastChannel', {
      configurable: true,
      value: class {
        set onmessage(callback: typeof receive) {
          receive = callback;
        }
        close = close;
      },
    });
    try {
      mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'owner' });
      mockFetch.mockResolvedValue(respond({ SiteName: '初始站点' }));
      const view = render(
        <SiteProvider {...baseProps}>
          <SiteDetails />
        </SiteProvider>,
      );
      await waitFor(() => expect(document.title).toBe('初始站点'));
      await act(async () =>
        receive({
          data: {
            type: 'invalidate',
            source: SERVER_CONFIG_INVALIDATION_SOURCE,
          },
        }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const visible = jest
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('hidden');
      await act(async () => receive({ data: { type: 'invalidate' } }));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      visible.mockReturnValue('visible');
      mockFetch.mockResolvedValue(respond({ SiteName: '其他标签保存' }));
      await act(async () =>
        document.dispatchEvent(new Event('visibilitychange')),
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(document.title).toBe('其他标签保存');
      view.unmount();
      expect(close).toHaveBeenCalled();
      visible.mockRestore();
    } finally {
      Object.defineProperty(global, 'BroadcastChannel', {
        configurable: true,
        value: original,
      });
    }
  });

  it('退出账号立即清除私有运行配置并重新读取游客配置', async () => {
    mockGetAuthInfo.mockReturnValue({ username: 'alice', role: 'owner' });
    mockFetch.mockResolvedValueOnce(respond({ EnableLiveEntry: true }));
    const view = render(
      <SiteProvider {...baseProps}>
        <SiteDetails />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(window.RUNTIME_CONFIG?.ENABLE_LIVE_ENTRY).toBe(true),
    );
    mockGetAuthInfo.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce(respond({ EnableLiveEntry: false }));
    view.rerender(
      <SiteProvider {...baseProps}>
        <SiteDetails />
      </SiteProvider>,
    );
    expect(window.RUNTIME_CONFIG?.ENABLE_LIVE_ENTRY).toBe(false);
    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

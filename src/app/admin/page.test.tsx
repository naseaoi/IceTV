import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type ReactNode, useState } from 'react';

import AdminPage from '@/app/admin/page';
import { useReportDirty } from '@/features/admin/hooks/useReportDirty';

function MockDirtyTab({
  label,
  formId,
  onDirtyChange,
}: {
  label: string;
  formId?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [dirty, setDirty] = useState(false);
  useReportDirty(dirty, onDirtyChange);
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        setDirty(false);
      }}
    >
      <button type='button' onClick={() => setDirty(true)}>
        {label}
      </button>
    </form>
  );
}

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/AuthenticatedRoute', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

let mockSessionRole: 'owner' | 'admin' = 'admin';
jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: {
      status: 'authenticated',
      username: 'tester',
      role: mockSessionRole,
    },
    isRefreshing: false,
    refreshSession: async () => {},
  }),
}));

jest.mock('@/components/modals/ConfirmModal', () => ({
  __esModule: true,
  default: ({
    isOpen,
    onConfirm,
    message,
  }: {
    message?: string;
    isOpen: boolean;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div>
        <p>{message}</p>
        <button onClick={onConfirm}>ConfirmModal</button>
      </div>
    ) : null,
}));

const mockReplace = jest.fn();
let mockSearch = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock('@/features/admin/components/tabs/UserConfigTab', () => ({
  __esModule: true,
  default: () => <div>UserConfigTab</div>,
}));
jest.mock('@/features/admin/components/tabs/VideoSourceConfigTab', () => ({
  __esModule: true,
  default: ({
    onOrderDirtyChange,
  }: {
    onOrderDirtyChange?: (dirty: boolean) => void;
  }) => (
    <MockDirtyTab
      label='VideoSourceConfigTab'
      onDirtyChange={onOrderDirtyChange}
    />
  ),
}));
jest.mock('@/features/admin/components/tabs/LiveSourceConfigTab', () => ({
  __esModule: true,
  default: () => <div>LiveSourceConfigTab</div>,
}));
jest.mock('@/features/admin/components/tabs/CategoryConfigTab', () => ({
  __esModule: true,
  default: () => <div>CategoryConfigTab</div>,
}));
jest.mock('@/features/admin/components/tabs/ConfigFileTab', () => ({
  __esModule: true,
  default: () => <div>ConfigFileTab</div>,
}));
jest.mock('@/features/admin/components/tabs/SiteConfigTab', () => ({
  __esModule: true,
  default: ({
    onDirtyChange,
  }: {
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <MockDirtyTab
      label='SiteConfigTab'
      formId='admin-site-config-form'
      onDirtyChange={onDirtyChange}
    />
  ),
}));

type UseAdminPageActionsOptions = {
  setConfig: (value: unknown) => void;
  setRole: (value: 'owner' | 'admin' | null) => void;
  setError: (value: string | null) => void;
  setLoading: (value: boolean) => void;
};

const mockUseAdminPageActions = jest.fn();
jest.mock('@/features/admin/hooks/useAdminPageActions', () => ({
  useAdminPageActions: (options: unknown) => mockUseAdminPageActions(options),
}));

describe('AdminPage role visibility', () => {
  const baseConfig = {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '',
    SiteConfig: {
      SiteName: 'IceTV',
      SiteIcon: '',
      Announcement: '',
      EnableLiveEntry: false,
      DefaultAggregateSearch: true,
      EnableOptimization: true,
      AutoSwitchSource: false,
      SearchDownstreamMaxPage: 1,
      SiteInterfaceCacheTime: 300,
      DoubanProxyType: '',
      DoubanImageProxyType: '',
      DisableYellowFilter: false,
      FluidSearch: true,
    },
    UserConfig: { Users: [], Tags: [] },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    mockSearch = '';
    mockSessionRole = 'admin';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setupRole(role: 'owner' | 'admin') {
    mockSessionRole = role;
    mockUseAdminPageActions.mockImplementation(
      (options: UseAdminPageActionsOptions) => ({
        fetchConfig: async () => {
          options.setConfig(baseConfig);
          options.setRole(role);
          options.setError(null);
          options.setLoading(false);
        },
        resetConfig: async () => {},
      }),
    );
  }

  function setupOwnerWithResetSpy(resetConfig: jest.Mock) {
    mockSessionRole = 'owner';
    mockUseAdminPageActions.mockImplementation(
      (options: UseAdminPageActionsOptions) => ({
        fetchConfig: async () => {
          options.setConfig(baseConfig);
          options.setRole('owner');
          options.setError(null);
          options.setLoading(false);
        },
        resetConfig,
      }),
    );
  }

  function setupError(error: string) {
    mockUseAdminPageActions.mockImplementation(
      (options: UseAdminPageActionsOptions) => ({
        fetchConfig: async () => {
          options.setConfig(null);
          options.setRole(null);
          options.setError(error);
          options.setLoading(false);
        },
        resetConfig: async () => {},
      }),
    );
  }

  it('shows owner-only sections for owner', async () => {
    mockSearch = 'tab=config-file';
    setupRole('owner');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('配置文件')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: '重置配置' }),
    ).toBeInTheDocument();
  });

  it('hides owner-only sections for admin', async () => {
    mockSearch = 'tab=config-file';
    setupRole('admin');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('站点设置')).toBeInTheDocument();
    });

    expect(screen.queryByText('配置文件')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '重置配置' }),
    ).not.toBeInTheDocument();
  });

  it('opens reset confirm modal and triggers reset action', async () => {
    let resolve!: () => void;
    const resetConfig = jest.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    mockSearch = 'tab=config-file';
    setupOwnerWithResetSpy(resetConfig);

    render(<AdminPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '重置配置' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '重置配置' }));

    await waitFor(() => {
      expect(screen.getByText('ConfirmModal')).toBeInTheDocument();
    });

    expect(screen.getByText(/用户权限与封禁不受影响/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('ConfirmModal'));
    expect(screen.getByRole('button', { name: '重置配置' })).toBeDisabled();
    await act(async () => {
      resolve();
    });
    await waitFor(() => {
      expect(resetConfig).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole('button', { name: '重置配置' }),
      ).not.toBeDisabled();
    });
  });

  it('shows login action when admin config is unauthorized', async () => {
    setupError('获取配置失败: 401');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('需要登录')).toBeInTheDocument();
    });

    expect(
      screen.getByText('请先登录管理员账号后再进入后台。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往登录' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fadmin',
    );
  });

  it('shows permission message when admin config is forbidden', async () => {
    setupError('获取配置失败: 403');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('无后台权限')).toBeInTheDocument();
    });

    expect(screen.getByText('当前账号没有后台访问权限。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('asks before switching tabs with unsaved changes', async () => {
    setupRole('admin');
    const { rerender } = render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('SiteConfigTab')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('SiteConfigTab'));
    fireEvent.click(screen.getByRole('button', { name: '用户' }));

    expect(screen.getByText('ConfirmModal')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('ConfirmModal'));

    expect(mockReplace).toHaveBeenCalledWith('/admin?tab=user', {
      scroll: false,
    });
    mockSearch = 'tab=user';
    rerender(<AdminPage />);
    await screen.findByText('UserConfigTab');

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '站点设置' }));
    expect(screen.queryByText('ConfirmModal')).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenLastCalledWith('/admin?tab=site', {
      scroll: false,
    });
  });

  it('asks before switching tabs with an unsaved source order', async () => {
    mockSearch = 'tab=video-source';
    setupRole('admin');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('VideoSourceConfigTab')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('VideoSourceConfigTab'));
    fireEvent.click(screen.getByRole('button', { name: '用户' }));

    expect(screen.getByText('ConfirmModal')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows a save bar for unsaved changes and discards them', async () => {
    setupRole('admin');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('SiteConfigTab')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('region', { name: '未保存的改动' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('SiteConfigTab'));
    expect(
      screen.getByRole('region', { name: '未保存的改动' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toHaveAttribute(
      'form',
      'admin-site-config-form',
    );

    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    expect(
      screen.queryByRole('region', { name: '未保存的改动' }),
    ).not.toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '用户' }));
    expect(screen.queryByText('ConfirmModal')).not.toBeInTheDocument();
  });

  it.each([
    ['site', 'SiteConfigTab'],
    ['video-source', 'VideoSourceConfigTab'],
  ])('clears unsaved state when the %s tab unmounts', async (tab, label) => {
    mockSearch = `tab=${tab}`;
    setupRole('admin');
    const { rerender } = render(<AdminPage />);
    fireEvent.click(await screen.findByText(label));
    expect(screen.getByTitle('有未保存的改动')).toBeInTheDocument();
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    // 浏览器前进/后退直接改变 URL，绕过导航按钮的切换确认。
    mockSearch = 'tab=user';
    rerender(<AdminPage />);
    await screen.findByText('UserConfigTab');
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
    expect(screen.queryByTitle('有未保存的改动')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '站点设置' }));
    expect(screen.queryByText('ConfirmModal')).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenLastCalledWith('/admin?tab=site', {
      scroll: false,
    });

    mockSearch = `tab=${tab}`;
    rerender(<AdminPage />);
    await screen.findByText(label);
    expect(
      screen.queryByRole('region', { name: '未保存的改动' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle('有未保存的改动')).not.toBeInTheDocument();
  });

  it.each(['ctrlKey', 'metaKey'])(
    'saves and clears unsaved state with %s+S',
    async (modifier) => {
      setupRole('admin');
      render(<AdminPage />);
      fireEvent.click(await screen.findByText('SiteConfigTab'));
      fireEvent.keyDown(window, { key: 's', [modifier]: true });

      expect(
        screen.queryByRole('region', { name: '未保存的改动' }),
      ).not.toBeInTheDocument();
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it('registers browser leave protection for unsaved changes', async () => {
    setupRole('admin');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('SiteConfigTab')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('SiteConfigTab'));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

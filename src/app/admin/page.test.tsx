import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdminPage from '@/app/admin/page';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/DataMigration', () => ({
  __esModule: true,
  default: () => <div>DataMigration</div>,
}));

jest.mock('@/features/admin/components/AlertModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/features/admin/components/ConfirmModal', () => ({
  __esModule: true,
  default: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) => (isOpen ? <button onClick={onConfirm}>ConfirmModal</button> : null),
}));

jest.mock('@/features/admin/components/CollapsibleTab', () => ({
  __esModule: true,
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

jest.mock('@/features/admin/components/tabs/UserConfigTab', () => ({
  __esModule: true,
  default: () => <div>UserConfigTab</div>,
}));
jest.mock('@/features/admin/components/tabs/VideoSourceConfigTab', () => ({
  __esModule: true,
  default: () => <div>VideoSourceConfigTab</div>,
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
  default: () => <div>SiteConfigTab</div>,
}));

jest.mock('@/features/admin/hooks/useAlertModal', () => ({
  useAlertModal: () => ({
    alertModal: { isOpen: false, type: 'success', title: '' },
    showAlert: jest.fn(),
    hideAlert: jest.fn(),
  }),
}));

jest.mock('@/features/admin/hooks/useLoadingState', () => ({
  useLoadingState: () => ({
    isLoading: () => false,
    withLoading: async (_key: string, fn: () => Promise<unknown>) => fn(),
  }),
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
      Announcement: '',
      SearchDownstreamMaxPage: 1,
      SiteInterfaceCacheTime: 300,
      DoubanProxyType: '',
      DoubanProxy: '',
      DoubanImageProxyType: '',
      DoubanImageProxy: '',
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
  });

  function setupRole(role: 'owner' | 'admin') {
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

  it('shows owner-only sections for owner', async () => {
    setupRole('owner');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('配置文件')).toBeInTheDocument();
    });

    expect(screen.getByText('数据迁移')).toBeInTheDocument();
    expect(screen.getByText('重置配置')).toBeInTheDocument();
  });

  it('hides owner-only sections for admin', async () => {
    setupRole('admin');
    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('站点配置')).toBeInTheDocument();
    });

    expect(screen.queryByText('配置文件')).not.toBeInTheDocument();
    expect(screen.queryByText('数据迁移')).not.toBeInTheDocument();
    expect(screen.queryByText('重置配置')).not.toBeInTheDocument();
  });

  it('opens reset confirm modal and triggers reset action', async () => {
    const resetConfig = jest.fn().mockResolvedValue(undefined);
    setupOwnerWithResetSpy(resetConfig);

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('重置配置')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('重置配置'));

    await waitFor(() => {
      expect(screen.getByText('ConfirmModal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('ConfirmModal'));

    await waitFor(() => {
      expect(resetConfig).toHaveBeenCalledTimes(1);
    });
  });
});

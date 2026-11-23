import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import RegistrationTab from '@/features/admin/components/tabs/RegistrationTab';
import type { AdminConfig } from '@/types/admin';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/admin',
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
jest.mock('@/features/admin/hooks/useAdminInviteCodes', () => ({
  useAdminInviteCodes: () => ({
    items: [],
    total: 0,
    activeCount: 0,
    inactiveCount: 0,
    totals: { expired: 0, exhausted: 0 },
    nextCursor: null,
    loading: false,
    error: '',
    refresh: jest.fn(),
    loadMore: jest.fn(),
  }),
}));

const mockActions = {
  createInviteCodes: jest.fn(),
  deleteInviteCode: jest.fn(),
  purgeInactiveInviteCodes: jest.fn(),
  setRequireInviteCode: jest.fn(),
  setLinuxDo: jest.fn(),
  setLinuxDoCredentials: jest.fn(),
  setRegisterChannels: jest.fn(),
  setDefaultUserGroup: jest.fn(),
  userAction: jest.fn(),
};
jest.mock('@/features/admin/hooks/useAdminUserActions', () => ({
  useAdminUserActions: () => mockActions,
}));

function makeConfig(
  userConfig: Partial<AdminConfig['UserConfig']> = {},
): AdminConfig {
  return {
    UserConfig: {
      OpenRegister: false,
      Tags: [],
      LinuxDo: {
        Enabled: false,
        MinTrustLevel: 1,
        ClientId: '',
        ClientSecret: '',
        RedirectUri: '',
      },
      ...userConfig,
    },
  } as unknown as AdminConfig;
}

function renderTab(config: AdminConfig) {
  render(<RegistrationTab config={config} refreshConfig={jest.fn()} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(mockActions).forEach((action) =>
    action.mockResolvedValue(undefined),
  );
});

it('confirms before enabling open registration', async () => {
  renderTab(makeConfig());

  expect(screen.queryByRole('group', { name: '注册通道' })).toBeNull();
  expect(screen.getByRole('switch', { name: '切换邀请码要求' })).toBeDisabled();
  fireEvent.click(screen.getByRole('switch', { name: '切换开放注册' }));
  expect(mockActions.userAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认开启' }));

  await waitFor(() =>
    expect(mockActions.userAction).toHaveBeenCalledWith(
      'setOpenRegister',
      undefined,
      undefined,
      undefined,
      true,
    ),
  );
});

it('shows register channels while registration is open', () => {
  renderTab(
    makeConfig({
      OpenRegister: true,
      RegisterChannels: { Password: false, LinuxDo: true },
    }),
  );
  expect(screen.getByRole('group', { name: '注册通道' })).toBeInTheDocument();
});

it('keeps LinuxDo login off until credentials are saved', () => {
  renderTab(makeConfig());
  expect(screen.getByText('未配置应用凭证')).toBeInTheDocument();
  expect(
    screen.getByRole('switch', { name: '切换 LinuxDo 登录' }),
  ).toBeDisabled();
});

it('saves credentials and then a changed trust level', async () => {
  renderTab(
    makeConfig({
      LinuxDoConfigured: true,
      LinuxDo: {
        Enabled: true,
        MinTrustLevel: 1,
        ClientId: 'saved-client',
        ClientSecret: '',
        RedirectUri: 'https://tv.example/api/auth/linuxdo/callback',
      },
    }),
  );
  expect(screen.getByText('最低信任等级 1')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '配置' }));
  fireEvent.click(screen.getByRole('button', { name: 'LinuxDo 最低信任等级' }));
  fireEvent.click(screen.getByRole('option', { name: '2 级 · 成员' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
  });

  expect(mockActions.setLinuxDoCredentials).toHaveBeenCalledWith({
    clientId: 'saved-client',
    clientSecret: '',
    redirectUri: 'https://tv.example/api/auth/linuxdo/callback',
  });
  expect(mockActions.setLinuxDo).toHaveBeenCalledWith({
    Enabled: true,
    MinTrustLevel: 2,
  });
});

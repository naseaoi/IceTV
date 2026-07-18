import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import UserConfigTab from '@/features/admin/components/tabs/UserConfigTab';

const mockUserAction = jest.fn();

jest.mock('@/components/modals/AlertModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/features/admin/components/tabs/user-config/UserTable', () => ({
  UserTable: ({
    onSetAdmin,
    onBanUser,
  }: {
    onSetAdmin: (username: string) => void;
    onBanUser: (username: string) => void;
  }) => (
    <>
      <button onClick={() => onSetAdmin('demo')}>测试设为管理</button>
      <button onClick={() => onBanUser('demo')}>测试封禁</button>
    </>
  ),
}));

jest.mock(
  '@/features/admin/components/tabs/user-config/UserGroupTable',
  () => ({
    UserGroupTable: () => null,
  }),
);

jest.mock('@/features/admin/components/tabs/user-config/AddUserForm', () => ({
  AddUserForm: () => null,
}));
jest.mock(
  '@/features/admin/components/tabs/user-config/BatchUserGroupDialog',
  () => ({ BatchUserGroupDialog: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/ChangePasswordForm',
  () => ({ ChangePasswordForm: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/ConfigureUserApisDialog',
  () => ({ ConfigureUserApisDialog: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/ConfigureUserGroupDialog',
  () => ({ ConfigureUserGroupDialog: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/DeleteUserConfirm',
  () => ({ DeleteUserConfirm: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/DeleteUserGroupConfirm',
  () => ({ DeleteUserGroupConfirm: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/UserGroupFormDialog',
  () => ({ UserGroupFormDialog: () => null }),
);

jest.mock('@/features/admin/hooks/useAdminUserActions', () => ({
  useAdminUserActions: () => ({
    userGroupAction: jest.fn(),
    assignUserGroups: jest.fn(),
    batchUpdateUserGroups: jest.fn(),
    updateUserApis: jest.fn(),
    userAction: mockUserAction,
  }),
}));

jest.mock('@/features/admin/hooks/useLoadingState', () => ({
  useLoadingState: () => ({
    isLoading: () => false,
    withLoading: async (_key: string, action: () => Promise<unknown>) =>
      action(),
  }),
}));

jest.mock('@/hooks/useAlertModal', () => ({
  useAlertModal: () => ({
    alertModal: { isOpen: false, type: 'success', title: '' },
    showAlert: jest.fn(),
    hideAlert: jest.fn(),
  }),
}));

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'owner' }),
}));

describe('UserConfigTab sensitive actions', () => {
  const config = {
    UserConfig: {
      OpenRegister: false,
      Users: [{ username: 'demo', role: 'user', banned: false }],
      Tags: [],
    },
    SourceConfig: [],
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserAction.mockResolvedValue(undefined);
  });

  it('confirms administrator authorization before executing it', async () => {
    render(
      <UserConfigTab config={config} role='owner' refreshConfig={jest.fn()} />,
    );

    fireEvent.click(screen.getByText('测试设为管理'));
    expect(mockUserAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认授权' }));

    await waitFor(() => {
      expect(mockUserAction).toHaveBeenCalledWith(
        'setAdmin',
        'demo',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  it('confirms before enabling open registration', async () => {
    render(
      <UserConfigTab config={config} role='owner' refreshConfig={jest.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '切换开放注册' }));
    expect(mockUserAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认开启' }));

    await waitFor(() => {
      expect(mockUserAction).toHaveBeenCalledWith(
        'setOpenRegister',
        undefined,
        undefined,
        undefined,
        true,
      );
    });
  });
});

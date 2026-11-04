import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { UserGroupTable } from '@/features/admin/components/tabs/user-config/UserGroupTable';
import UserConfigTab from '@/features/admin/components/tabs/UserConfigTab';

const mockUserAction = jest.fn();
const mockIsLoading = jest.fn((_key: string) => false);
const mockGetAuthInfo = jest.fn(() => ({ username: 'owner' }));

jest.mock('@/components/modals/AlertModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/features/admin/hooks/useUserActivity', () => ({
  useUserActivity: () => ({
    lastActiveAt: {},
    refreshActivity: jest.fn(),
  }),
}));

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
    isLoading: mockIsLoading,
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
  getAuthInfoFromBrowserCookie: () => mockGetAuthInfo(),
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

    fireEvent.click(screen.getByRole('button', { name: 'demo 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '设为管理' }));
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

    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    const registerSwitch = screen.getByRole('switch', { name: '切换开放注册' });
    expect(registerSwitch).not.toBeChecked();
    expect(
      screen.getByRole('switch', { name: '切换邀请码要求' }),
    ).toBeDisabled();
    fireEvent.click(registerSwitch);
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

describe('UserConfigTab user search and selection', () => {
  const users = [
    { username: 'owner', role: 'owner' },
    { username: 'manager', role: 'admin' },
    { username: 'Alice', role: 'user', tags: ['VIP'] },
    { username: 'Bob', role: 'user', tags: ['Standard'] },
    { username: 'Blocked', role: 'user', banned: true, tags: ['VIP'] },
  ];
  const config = {
    UserConfig: { Users: users, Tags: [], OpenRegister: false },
    SourceConfig: [],
  } as never;

  function setup(role: 'owner' | 'admin' = 'owner') {
    mockGetAuthInfo.mockReturnValue({
      username: role === 'owner' ? 'owner' : 'current-admin',
    });
    render(
      <UserConfigTab config={config} role={role} refreshConfig={jest.fn()} />,
    );
    return screen.getByRole('searchbox', { name: '搜索用户名或用户组' });
  }

  function filterUsers(label: string) {
    fireEvent.click(screen.getByRole('button', { name: '筛选用户角色或状态' }));
    fireEvent.click(screen.getByRole('option', { name: label }));
  }

  function expectVisibleUsers(usernames: string[]) {
    const list = screen.getByRole('list', { name: '用户列表' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(
      usernames.length,
    );
    usernames.forEach((username) => {
      expect(
        within(list).getByText(username, { exact: true }),
      ).toBeInTheDocument();
    });
  }

  it('places the user list before groups and removes the standalone count card', () => {
    setup();
    expect(
      screen.getAllByRole('heading').map((heading) => heading.textContent),
    ).toEqual(['用户列表', '用户组']);
    expect(screen.queryByText('用户统计')).not.toBeInTheDocument();
    expect(screen.queryByText('总用户数')).not.toBeInTheDocument();
    expect(screen.getByText('开放注册 · 已关闭')).toBeInTheDocument();
  });

  it('searches usernames and groups case-insensitively after trimming', () => {
    const search = setup();
    fireEvent.change(search, { target: { value: '  aLiCe  ' } });
    expectVisibleUsers(['Alice']);
    fireEvent.change(search, { target: { value: '  vip  ' } });
    expectVisibleUsers(['Alice', 'Blocked']);
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expectVisibleUsers(users.map((user) => user.username));
    fireEvent.change(search, { target: { value: '   ' } });
    expectVisibleUsers(users.map((user) => user.username));
  });

  it.each([
    ['全部', ['owner', 'manager', 'Alice', 'Bob', 'Blocked']],
    ['站长', ['owner']],
    ['管理员', ['manager']],
    ['普通用户', ['Alice', 'Bob', 'Blocked']],
    ['已封禁', ['Blocked']],
  ])('filters by %s', (label, usernames) => {
    setup();
    filterUsers(label as string);
    expectVisibleUsers(usernames as string[]);
  });

  it('combines search with the status filter and shows an empty state', () => {
    const search = setup();
    filterUsers('已封禁');
    fireEvent.change(search, { target: { value: 'VIP' } });
    expectVisibleUsers(['Blocked']);
    fireEvent.change(search, { target: { value: 'Alice' } });
    expect(screen.getByText('没有匹配的用户')).toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: '用户列表' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('selects and deselects only visible rows while preserving hidden selections', () => {
    const search = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择用户 Bob' }));
    fireEvent.change(search, { target: { value: 'VIP' } });
    const selectAll = screen.getByRole('checkbox', { name: '全选当前用户' });
    expect(selectAll).not.toBeChecked();
    fireEvent.click(selectAll);
    expect(selectAll).toBeChecked();
    expect(screen.getByText('已选 3 人')).toBeInTheDocument();
    fireEvent.click(selectAll);
    expect(selectAll).not.toBeChecked();
    expect(screen.getByText('已选 1 人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(
      screen.getByRole('checkbox', { name: '选择用户 Bob' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: '选择用户 Alice' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: '选择用户 Blocked' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: '选择用户 manager' }),
    ).not.toBeChecked();
  });

  it('does not mistake equally sized hidden selections for all visible users being selected', () => {
    const search = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择用户 Alice' }));
    fireEvent.change(search, { target: { value: 'Bob' } });
    expect(
      screen.getByRole('checkbox', { name: '全选当前用户' }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前用户' }));
    expect(screen.getByText('已选 2 人')).toBeInTheDocument();
  });

  it('shows owner actions in a portal menu with destructive deletion last', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Alice 的操作' }));
    const menu = screen.getByRole('menu', { name: 'Alice 的操作' });
    expect(menu.parentElement).toBe(document.body);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      '配置用户组',
      '配置视频源',
      '修改密码',
      '设为管理',
      '封禁',
      '删除用户',
    ]);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'manager 的操作' }));
    expect(
      screen.getByRole('menuitem', { name: '取消管理' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Blocked 的操作' }));
    expect(screen.getByRole('menuitem', { name: '解封' })).toBeInTheDocument();
  });

  it('hides unauthorized menus and restricts current owner actions', () => {
    setup('admin');
    expect(
      screen.queryByRole('button', { name: 'owner 的操作' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'manager 的操作' }),
    ).not.toBeInTheDocument();
  });

  it('disables actions using the existing loading keys', () => {
    mockIsLoading.mockImplementation((key) =>
      ['ban_Alice', 'deleteUser_Alice'].includes(key),
    );
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Alice 的操作' }));
    expect(screen.getByRole('menuitem', { name: '封禁' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: '删除用户' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: '配置用户组' })).toBeEnabled();
    mockIsLoading.mockReturnValue(false);
  });

  it('keeps administrator selection limited to configurable visible users', () => {
    setup('admin');
    filterUsers('管理员');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    filterUsers('全部');
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前用户' }));
    expect(screen.getByText('已选 3 人')).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: '选择用户 owner' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: '选择用户 manager' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: '选择用户 Alice' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: '选择用户 Bob' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: '选择用户 Blocked' }),
    ).toBeChecked();
  });
});

describe('UserGroupTable responsive list', () => {
  it('opens edit and delete actions through the row menu', () => {
    const group = { name: 'VIP', enabledApis: ['source-a'] };
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    render(
      <UserGroupTable
        userGroups={[group]}
        isEditLoading={() => false}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByRole('list', { name: '用户组' })).toBeInTheDocument();
    expect(screen.getByText('可用视频源: 1 个')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'VIP 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalledWith(group);
    fireEvent.click(screen.getByRole('button', { name: 'VIP 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledWith('VIP');
  });

  it('disables an editing group and shows unlimited sources', () => {
    render(
      <UserGroupTable
        userGroups={[{ name: 'VIP' }]}
        isEditLoading={() => true}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText('可用视频源: 无限制')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'VIP 的操作' }));
    expect(screen.getByRole('menuitem', { name: '编辑' })).toBeDisabled();
  });

  it('shows an empty state without a table', () => {
    render(
      <UserGroupTable
        userGroups={[]}
        isEditLoading={() => false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText('暂无用户组')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

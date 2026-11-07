import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { UserGroupTable } from '@/features/admin/components/tabs/user-config/UserGroupTable';
import UserConfigTab from '@/features/admin/components/tabs/UserConfigTab';
import { showToast } from '@/lib/toast';

const mockBatchPost = jest.fn();
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

jest.mock('@/features/admin/lib/api', () => ({
  adminPost: (...args: unknown[]) => mockBatchPost(...args),
  adminGet: jest.fn(),
}));
const mockUserAction = jest.fn();
let mockRows: Array<{
  username: string;
  role: string;
  banned?: boolean;
  tags?: string[];
  nickname?: string;
}> = [];
let mockNextCursor: string | null = null;
jest.mock('@/features/admin/hooks/useAdminUsers', () => ({
  useAdminUsers: (query: { q: string; filter: string }) => {
    const q = query.q.trim().toLowerCase();
    const items = mockRows.filter(
      (row) =>
        (!q ||
          row.username.toLowerCase().includes(q) ||
          row.nickname?.toLowerCase().includes(q)) &&
        (query.filter === 'all' ||
          (query.filter === 'banned' ? row.banned : row.role === query.filter)),
    );
    return {
      items,
      total: items.length,
      nextCursor: mockNextCursor,
      loading: false,
      error: '',
      refresh: jest.fn(),
      loadMore: jest.fn(),
    };
  },
}));
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
  () => ({
    BatchUserGroupDialog: ({
      isOpen,
      onConfirm,
    }: {
      isOpen: boolean;
      onConfirm: () => void;
    }) => (isOpen ? <button onClick={onConfirm}>预估批量操作</button> : null),
  }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/ChangePasswordForm',
  () => ({ ChangePasswordForm: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/DeleteUserConfirm',
  () => ({ DeleteUserConfirm: () => null }),
);
jest.mock(
  '@/features/admin/components/tabs/user-config/DeleteUserGroupConfirm',
  () => ({ DeleteUserGroupConfirm: () => null }),
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
    mockNextCursor = null;
    mockUserAction.mockResolvedValue(undefined);
    mockRows = [{ username: 'demo', role: 'user' }];
  });

  it.each([
    ['配置视频源', '配置用户视频源权限 - demo'],
    ['配置用户组', '配置用户组 - demo'],
  ])('%s 关闭后保留内容直到退出动画结束', async (action, title) => {
    render(
      <UserConfigTab config={config} role='owner' refreshConfig={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'demo 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: action }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(
      screen.getByRole('heading', { name: title }).closest('.motion-dialog'),
    ).toHaveAttribute('data-open', 'false');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: title })).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'demo 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: action }));
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });

  it('编辑用户组关闭时保留名称与选择，重新打开恢复原始选择', async () => {
    const groupConfig = {
      UserConfig: {
        OpenRegister: false,
        Users: [],
        Tags: [{ name: 'VIP', enabledApis: ['a'] }],
      },
      SourceConfig: [
        { key: 'a', name: '源甲', api: 'https://example.com', disabled: false },
      ],
    } as never;
    render(
      <UserConfigTab
        config={groupConfig}
        role='owner'
        refreshConfig={jest.fn()}
      />,
    );
    const open = () => {
      fireEvent.click(screen.getByRole('button', { name: 'VIP 的操作' }));
      fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
    };
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(
      screen
        .getByRole('heading', { name: '编辑用户组 - VIP' })
        .closest('.motion-dialog'),
    ).toHaveAttribute('data-open', 'false');
    expect(screen.getByRole('checkbox', { name: '全选' })).not.toBeChecked();
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: '编辑用户组 - VIP' }),
      ).toBeNull(),
    );
    open();
    expect(screen.getByRole('checkbox', { name: '全选' })).toBeChecked();
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
      expect(showToast).toHaveBeenCalledWith('开放注册设置已更新', 'success');
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

  beforeEach(() => {
    mockNextCursor = null;
  });

  function setup(role: 'owner' | 'admin' = 'owner') {
    mockRows = users.map((user) => ({ ...user, nickname: user.tags?.[0] }));
    mockGetAuthInfo.mockReturnValue({
      username: role === 'owner' ? 'owner' : 'current-admin',
    });
    render(
      <UserConfigTab config={config} role={role} refreshConfig={jest.fn()} />,
    );
    return screen.getByRole('searchbox', { name: '搜索用户名或昵称' });
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

  it('resets selections when conditions change and offers all matching users', () => {
    mockNextCursor = 'next-page';
    const search = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择用户 Bob' }));
    fireEvent.change(search, { target: { value: 'VIP' } });
    const selectAll = screen.getByRole('checkbox', { name: '全选当前用户' });
    expect(selectAll).not.toBeChecked();
    fireEvent.click(selectAll);
    expect(
      screen.getByRole('button', { name: '选择全部 2 个匹配用户' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: '选择全部 2 个匹配用户' }),
    );
    expect(screen.getByText('已选择全部 2 个匹配用户')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择用户 Alice' }));
    expect(screen.getByText('已选择全部 1 个匹配用户')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(
      screen.getByRole('checkbox', { name: '选择用户 Bob' }),
    ).not.toBeChecked();
    expect(
      screen.queryByText(/已选择全部 \d+ 个匹配用户/),
    ).not.toBeInTheDocument();
  });

  it('does not mistake equally sized hidden selections for all visible users being selected', () => {
    const search = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择用户 Alice' }));
    fireEvent.change(search, { target: { value: 'Bob' } });
    expect(
      screen.getByRole('checkbox', { name: '全选当前用户' }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前用户' }));
    expect(screen.getByText('共 1 人 · 已选 1 人')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /选择全部 \d+ 个匹配用户/ }),
    ).not.toBeInTheDocument();
  });

  it('uses server preview counts and submits filters with exclusions', async () => {
    mockBatchPost
      .mockResolvedValueOnce({ affectedCount: 2, skippedCount: 1 })
      .mockResolvedValueOnce({ processedCount: 2, skippedCount: 1 });
    mockNextCursor = 'next-page';
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前用户' }));
    fireEvent.click(
      screen.getByRole('button', { name: '选择全部 5 个匹配用户' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '选择用户 Bob' }));
    fireEvent.click(screen.getByRole('button', { name: '批量设置用户组' }));
    fireEvent.click(screen.getByRole('button', { name: '预估批量操作' }));
    expect(
      await screen.findByText('预计处理 2 个用户，跳过 1 个。'),
    ).toBeInTheDocument();
    expect(mockBatchPost).toHaveBeenLastCalledWith(
      '/api/admin/user',
      expect.objectContaining({
        dryRun: true,
        selection: {
          mode: 'all',
          filter: { q: '', filter: 'all', group: '' },
          excluded: ['Bob'],
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(mockBatchPost).toHaveBeenCalledTimes(2));
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
    expect(screen.getByText('共 5 人 · 已选 3 人')).toBeInTheDocument();
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

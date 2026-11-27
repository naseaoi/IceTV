import { act, render, screen, waitFor } from '@testing-library/react';

import { useAuthSession } from '@/components/AuthProvider';
import { VersionPanel } from '@/components/VersionPanel';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: jest.fn(),
}));
jest.mock('@/lib/version', () => ({ CURRENT_VERSION: '2.0.0' }));
jest.mock('@/lib/changelog', () => ({
  changelog: [
    {
      version: '2.0.0',
      date: '2026-11-05',
      added: ['前台新功能'],
      changed: [
        '界面精简：卡片只保留状态',
        '切换筛选时保留当前列表而不是清空重新加载：更顺滑',
      ],
      fixed: ['**签名密钥统一**：改用 `AUTH_SECRET`，代码里的 `**` 原样显示'],
      admin: ['当前版本后台改动'],
    },
    {
      version: '1.9.0',
      date: '2026-10-01',
      added: [],
      changed: [],
      fixed: [],
      admin: ['仅后台改动'],
    },
  ],
}));

const mockedSession = jest.mocked(useAuthSession);

function asRole(role: 'owner' | 'admin' | 'user') {
  mockedSession.mockReturnValue({
    session: {
      status: 'authenticated',
      username: 'u',
      role,
      profileId: 'p',
      nickname: 'n',
      avatarSeed: null,
    },
    isRefreshing: false,
    refreshSession: jest.fn(),
  } as unknown as ReturnType<typeof useAuthSession>);
}

describe('VersionPanel 后台条目', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never;
  });

  it('keeps history without offering a stable fallback when latestVersion is null', async () => {
    asRole('admin');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: null,
        changelog: [
          {
            version: '9.0.0',
            date: '2026-11-22',
            added: ['Remote history'],
            changed: [],
            fixed: [],
            admin: [],
          },
        ],
      }),
    });
    render(<VersionPanel isOpen onClose={jest.fn()} />);
    await screen.findByText('Remote history');
    expect(screen.queryByText('v9.0.0 可用')).not.toBeInTheDocument();
  });

  it('offers a dev release without requiring a changelog entry', async () => {
    asRole('admin');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ latestVersion: '3.0.0-dev.7', changelog: [] }),
    });
    render(<VersionPanel isOpen onClose={jest.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('v3.0.0-dev.7 可用')).toBeInTheDocument(),
    );
  });

  it('站长在升级状态返回前看到不可点的「升级」，不显示「前往更新」', async () => {
    asRole('owner');
    let resolveStatus: (value: unknown) => void = () => undefined;
    global.fetch = jest.fn((url: string) =>
      url === '/api/admin/upgrade'
        ? new Promise((resolve) => {
            resolveStatus = resolve;
          })
        : Promise.resolve({
            ok: true,
            json: async () => ({ latestVersion: '3.0.0', changelog: [] }),
          }),
    ) as never;
    render(<VersionPanel isOpen onClose={jest.fn()} />);

    const button = await screen.findByRole('button', { name: '升级' });
    expect(button).toBeDisabled();
    expect(screen.queryByText('前往更新')).not.toBeInTheDocument();

    resolveStatus({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({
        available: true,
        status: { capable: true, job: { phase: 'idle' } },
      }),
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '升级' })).toBeEnabled(),
    );
  });

  it.each(['owner', 'admin'] as const)(
    '%s 看到后台条目与仅后台改动的版本',
    async (role) => {
      asRole(role);
      render(<VersionPanel isOpen onClose={jest.fn()} />);
      await act(async () => undefined);

      expect(screen.getByText('当前版本后台改动')).toBeInTheDocument();
      expect(screen.getByText('仅后台改动')).toBeInTheDocument();
    },
  );

  it('普通用户看不到后台条目，仅后台改动的历史版本整条隐藏', () => {
    asRole('user');
    render(<VersionPanel isOpen onClose={jest.fn()} />);

    expect(screen.getByText('前台新功能')).toBeInTheDocument();
    expect(screen.queryByText('当前版本后台改动')).not.toBeInTheDocument();
    expect(screen.queryByText(/1\.9\.0/)).not.toBeInTheDocument();
  });

  it('「主题：细节」写法的条目单独标出主题，过长前缀保持原样', () => {
    asRole('user');
    render(<VersionPanel isOpen onClose={jest.fn()} />);

    expect(screen.getByText('界面精简：').closest('li')).toHaveTextContent(
      '界面精简：卡片只保留状态',
    );
    expect(
      screen.getByText('切换筛选时保留当前列表而不是清空重新加载：更顺滑'),
    ).toBeInTheDocument();
  });

  it('条目中的加粗与行内代码按 Markdown 渲染', () => {
    asRole('user');
    render(<VersionPanel isOpen onClose={jest.fn()} />);

    const strong = screen.getByText('签名密钥统一');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.getByText('AUTH_SECRET').tagName).toBe('CODE');
    expect(screen.getByText('**').tagName).toBe('CODE');
    expect(strong.closest('li')).toHaveTextContent(
      '签名密钥统一：改用 AUTH_SECRET，代码里的 ** 原样显示',
    );
  });
});

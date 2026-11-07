import { render, screen } from '@testing-library/react';

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
      changed: [],
      fixed: [],
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

  it.each(['owner', 'admin'] as const)(
    '%s 看到后台条目与仅后台改动的版本',
    (role) => {
      asRole(role);
      render(<VersionPanel isOpen onClose={jest.fn()} />);

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
});

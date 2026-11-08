import { act, render, screen } from '@testing-library/react';

import { useAuthSession } from '@/components/AuthProvider';
import ReleaseNotifier, {
  RELEASE_TOAST_KEY,
} from '@/components/ReleaseNotifier';
import { showToast } from '@/lib/toast';
import { checkLatestRelease, UpdateStatus } from '@/lib/version-check';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: jest.fn(),
}));
jest.mock('@/components/user-menu/lazy-panels', () => ({
  VersionPanel: () => <div role='dialog' aria-label='版本信息' />,
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/lib/version-check', () => ({
  checkLatestRelease: jest.fn(),
  UpdateStatus: {
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
    FETCH_FAILED: 'fetch_failed',
  },
}));

const mockedSession = jest.mocked(useAuthSession);
const mockedCheck = jest.mocked(checkLatestRelease);
const mockedToast = jest.mocked(showToast);

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

async function flushCheck() {
  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });
}

describe('ReleaseNotifier', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    mockedToast.mockClear();
    mockedCheck.mockClear();
    mockedCheck.mockResolvedValue({
      status: UpdateStatus.HAS_UPDATE,
      latestVersion: '2.4.0',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('站长看到一次新版本提醒，查看打开版本面板', async () => {
    asRole('owner');
    const { unmount } = render(<ReleaseNotifier />);
    await flushCheck();

    expect(mockedToast).toHaveBeenCalledWith(
      'IceTV v2.4.0 已发布',
      'notice',
      expect.objectContaining({ key: RELEASE_TOAST_KEY }),
    );
    const { action } = mockedToast.mock.calls[0][2] ?? {};
    act(() => action?.onClick());
    expect(
      screen.getByRole('dialog', { name: '版本信息' }),
    ).toBeInTheDocument();

    unmount();
    render(<ReleaseNotifier />);
    await flushCheck();
    expect(mockedToast).toHaveBeenCalledTimes(1);
  });

  it('非站长不提醒', async () => {
    asRole('admin');
    render(<ReleaseNotifier />);
    await flushCheck();

    expect(mockedCheck).not.toHaveBeenCalled();
    expect(mockedToast).not.toHaveBeenCalled();
  });
});

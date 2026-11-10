import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  type InviteCodeListState,
  RegistrationSettingsDialog,
} from '@/features/admin/components/tabs/user-config/RegistrationSettingsDialog';
import { copyTextToClipboard } from '@/lib/clipboard';
import { showToast } from '@/lib/toast';
jest.mock('@/lib/clipboard', () => ({ copyTextToClipboard: jest.fn() }));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

const DAY = 24 * 60 * 60 * 1000;

function renderDialog(
  list: Partial<InviteCodeListState> = {},
  filter: 'all' | 'active' | 'expired' | 'exhausted' = 'all',
  onCreateCodes = jest.fn().mockResolvedValue(null),
) {
  const inviteList: InviteCodeListState = {
    items: [],
    total: 0,
    activeCount: 0,
    inactiveCount: 0,
    nextCursor: null,
    loading: false,
    error: '',
    refresh: jest.fn(),
    loadMore: jest.fn(),
    ...list,
  };
  const onDeleteCode = jest.fn();
  const onPurgeInactiveCodes = jest.fn();
  render(
    <RegistrationSettingsDialog
      isOpen
      openRegister
      requireInviteCode
      userGroupNames={[]}
      defaultUserGroup=''
      isSettingDefaultGroup={false}
      inviteFilter={filter}
      inviteList={inviteList}
      isTogglingRegister={false}
      isTogglingInvite={false}
      linuxDoConfigured={false}
      linuxDo={{ Enabled: false, MinTrustLevel: 1 }}
      isSettingLinuxDo={false}
      onToggleLinuxDo={jest.fn()}
      onLinuxDoTrustLevelChange={jest.fn()}
      isCreatingCode={false}
      deletingCode={null}
      isPurgingCodes={false}
      onToggleOpenRegister={jest.fn()}
      onToggleRequireInviteCode={jest.fn()}
      onDefaultUserGroupChange={jest.fn()}
      onInviteFilterChange={jest.fn()}
      onCreateCodes={onCreateCodes}
      onDeleteCode={onDeleteCode}
      onPurgeInactiveCodes={onPurgeInactiveCodes}
      onClose={jest.fn()}
    />,
  );
  return { inviteList, onDeleteCode, onPurgeInactiveCodes };
}

describe('RegistrationSettingsDialog invite code list', () => {
  it('renders paged rows with status, remaining uses and load more', () => {
    const now = Date.now();
    const { inviteList, onDeleteCode } = renderDialog({
      items: [
        {
          code: 'ACTIVE01',
          createdAt: now,
          expiresAt: now + DAY,
          createdBy: 'owner',
          maxUses: 5,
          usedCount: 2,
        },
        {
          code: 'OLD00001',
          createdAt: now - 3 * DAY,
          expiresAt: now - DAY,
          createdBy: 'owner',
        },
      ],
      total: 7,
      activeCount: 4,
      nextCursor: 'next',
    });

    const list = screen.getByRole('list', { name: '邀请码列表' });
    expect(list).toHaveTextContent('ACTIVE01');
    expect(list).toHaveTextContent('剩余 3 / 5');
    expect(list).toHaveTextContent('已过期');
    expect(screen.getByText('共 7 个')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(inviteList.loadMore).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole('button', { name: '删除邀请码 OLD00001' }),
    );
    expect(onDeleteCode).toHaveBeenCalledWith('OLD00001');
  });

  it('offers purging only when inactive codes exist', () => {
    const { onPurgeInactiveCodes } = renderDialog({ inactiveCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: /清理失效 3/ }));
    expect(onPurgeInactiveCodes).toHaveBeenCalledTimes(1);
  });

  it('hides purging when every code is active', () => {
    renderDialog({ activeCount: 2 });
    expect(
      screen.queryByRole('button', { name: /清理失效/ }),
    ).not.toBeInTheDocument();
  });

  it('shows a filter-aware empty state', () => {
    renderDialog({}, 'expired');
    expect(screen.getByText('没有符合条件的邀请码')).toBeInTheDocument();
  });

  it('offers retry when loading fails', () => {
    const { inviteList } = renderDialog({ error: '加载邀请码失败' });
    expect(screen.getByRole('alert')).toHaveTextContent('加载邀请码失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(inviteList.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/共 \d+ 个/)).not.toBeInTheDocument();
  });

  it('matches skeleton rows to the expected count, capped by list height', () => {
    renderDialog({ loading: true, expectedCount: 3 });
    expect(
      screen.getByRole('status', { name: '加载邀请码' }).childElementCount,
    ).toBe(3);
  });

  it('caps skeleton rows for long lists', () => {
    renderDialog({ loading: true, expectedCount: 40 });
    expect(
      screen.getByRole('status', { name: '加载邀请码' }).childElementCount,
    ).toBeLessThan(40);
  });

  it('falls back to one skeleton row when the count is unknown', () => {
    renderDialog({ loading: true });
    expect(
      screen.getByRole('status', { name: '加载邀请码' }).childElementCount,
    ).toBe(1);
  });

  it('shows the empty state while loading when no codes are expected', () => {
    renderDialog({ loading: true, expectedCount: 0 });
    expect(
      screen.queryByRole('status', { name: '加载邀请码' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('还没有邀请码')).toBeInTheDocument();
  });
});

describe('RegistrationSettingsDialog invite code generator', () => {
  it('creates a batch of random codes and lists them for copying', async () => {
    const codes = ['AAAA2222BBBB', 'CCCC3333DDDD', 'EEEE4444FFFF'];
    const onCreateCodes = jest.fn().mockResolvedValue(codes);
    renderDialog({}, 'all', onCreateCodes);

    fireEvent.change(screen.getByLabelText('自定义邀请码'), {
      target: { value: 'welcome' },
    });
    fireEvent.change(screen.getByLabelText('数量'), {
      target: { value: '3' },
    });
    expect(screen.getByLabelText('自定义邀请码')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('每码可用'), {
      target: { value: '2' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成 3 个/ }));
    });

    expect(onCreateCodes).toHaveBeenCalledWith({
      count: 3,
      validDays: 7,
      maxUses: 2,
    });
    const created = screen.getByRole('list', { name: '本次生成的邀请码' });
    codes.forEach((code) => expect(created).toHaveTextContent(code));
    expect(
      screen.getByRole('button', { name: '复制全部' }),
    ).toBeInTheDocument();
  });

  it('keeps the batch size within the remaining invite code capacity', async () => {
    const onCreateCodes = jest.fn();
    renderDialog({ activeCount: 195 }, 'all', onCreateCodes);

    fireEvent.change(screen.getByLabelText('数量'), {
      target: { value: '6' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '生成' }));
    });

    expect(onCreateCodes).not.toHaveBeenCalled();
    expect(screen.getByLabelText('数量')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText('数量需在 1-5 之间')).toBeInTheDocument();
  });

  it('disables generation when the active code limit is reached', () => {
    renderDialog({ activeCount: 200 });
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled();
  });
});

it('复制失败显示错误，邀请码保留', async () => {
  jest.mocked(copyTextToClipboard).mockResolvedValueOnce(false);
  renderDialog({
    items: [
      {
        code: 'COPYFAIL',
        createdAt: Date.now(),
        expiresAt: Date.now() + DAY,
        createdBy: 'owner',
      },
    ],
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: '复制邀请码 COPYFAIL' }),
    );
  });
  expect(showToast).toHaveBeenCalledWith('复制失败，请重试', 'error');
  expect(screen.getByText('COPYFAIL')).toBeInTheDocument();
});

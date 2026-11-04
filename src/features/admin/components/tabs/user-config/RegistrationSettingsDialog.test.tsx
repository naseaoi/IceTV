import { fireEvent, render, screen } from '@testing-library/react';

import {
  type InviteCodeListState,
  RegistrationSettingsDialog,
} from '@/features/admin/components/tabs/user-config/RegistrationSettingsDialog';

const DAY = 24 * 60 * 60 * 1000;

function renderDialog(
  list: Partial<InviteCodeListState> = {},
  filter: 'all' | 'active' | 'expired' | 'exhausted' = 'all',
) {
  const inviteList: InviteCodeListState = {
    items: [],
    total: 0,
    activeCount: 0,
    nextCursor: null,
    loading: false,
    error: '',
    refresh: jest.fn(),
    loadMore: jest.fn(),
    ...list,
  };
  const onDeleteCode = jest.fn();
  render(
    <RegistrationSettingsDialog
      isOpen
      openRegister
      requireInviteCode
      inviteFilter={filter}
      inviteList={inviteList}
      validDays={7}
      customCode=''
      maxUses=''
      isTogglingRegister={false}
      isTogglingInvite={false}
      isCreatingCode={false}
      deletingCode={null}
      onToggleOpenRegister={jest.fn()}
      onToggleRequireInviteCode={jest.fn()}
      onInviteFilterChange={jest.fn()}
      onValidDaysChange={jest.fn()}
      onCustomCodeChange={jest.fn()}
      onMaxUsesChange={jest.fn()}
      onCreateCode={jest.fn()}
      onDeleteCode={onDeleteCode}
      onClose={jest.fn()}
    />,
  );
  return { inviteList, onDeleteCode };
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

  it('shows skeleton rows on first load', () => {
    renderDialog({ loading: true });
    expect(
      screen.getByRole('status', { name: '加载邀请码' }),
    ).toBeInTheDocument();
  });
});

import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import PlayerShortcutsModal from '@/components/PlayerShortcutsModal';
import { OPEN_PLAYER_SHORTCUTS_EVENT } from '@/lib/player-shortcuts';

jest.mock('@/components/modals/ModalShell', () => ({
  __esModule: true,
  default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

jest.mock('@/components/modals/ConfirmModal', () => ({
  __esModule: true,
  default: () => null,
}));

describe('PlayerShortcutsModal', () => {
  it('shows only live-safe shortcuts in live mode', () => {
    render(<PlayerShortcutsModal mode='live' />);

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_PLAYER_SHORTCUTS_EVENT));
    });

    expect(screen.getByText('播放 / 暂停')).toBeInTheDocument();
    expect(screen.getByText('音量 +')).toBeInTheDocument();
    expect(screen.getByText('音量 -')).toBeInTheDocument();
    expect(screen.getByText('全屏')).toBeInTheDocument();
    expect(screen.queryByText('快退 5 秒')).not.toBeInTheDocument();
    expect(screen.queryByText('增加倍速 0.1')).not.toBeInTheDocument();
    expect(screen.queryByText('下一帧')).not.toBeInTheDocument();
    expect(screen.queryByText('下一集')).not.toBeInTheDocument();
  });

  it('places close in the header and reset beside save', () => {
    render(<PlayerShortcutsModal />);

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_PLAYER_SHORTCUTS_EVENT));
    });

    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    const resetButton = screen.getByRole('button', { name: '重置' });
    expect(resetButton).toBeInTheDocument();
    expect(resetButton.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '取消' }),
    ).not.toBeInTheDocument();
  });
});

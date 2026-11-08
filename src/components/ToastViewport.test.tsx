import { act, fireEvent, render, screen } from '@testing-library/react';

import ToastViewport, { TOAST_LEAVE_MS } from '@/components/ToastViewport';
import { dismissToast, showToast } from '@/lib/toast';

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('ToastViewport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('按语气计时后播放离场再移除', () => {
    render(<ToastViewport />);

    act(() => {
      showToast('已复制主页链接', 'success');
      showToast('加载失败', 'error');
    });
    expect(screen.getByRole('status')).toHaveTextContent('已复制主页链接');
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');

    advance(2600);
    expect(
      screen.getByText('已复制主页链接').closest('[data-phase]'),
    ).toHaveAttribute('data-phase', 'leave');
    advance(TOAST_LEAVE_MS);
    expect(screen.queryByText('已复制主页链接')).not.toBeInTheDocument();
    expect(screen.getByText('加载失败')).toBeInTheDocument();
  });

  it('同 key 原地更新文案并重新计时，不叠加', () => {
    render(<ToastViewport />);

    act(() => {
      showToast('1 条新消息', 'notice', { key: 'messages' });
    });
    advance(5000);
    act(() => {
      showToast('2 条新消息', 'notice', { key: 'messages' });
    });

    expect(screen.queryByText('1 条新消息')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(
      screen.getByText('2 条新消息').closest('.toast-motion'),
    ).toHaveAttribute('data-bump', 'a');

    advance(5000);
    expect(screen.getByText('2 条新消息')).toBeInTheDocument();
  });

  it('超过三条时最早的一条离场', () => {
    render(<ToastViewport />);

    act(() => {
      ['一', '二', '三', '四'].forEach((text) => showToast(text));
    });
    advance(TOAST_LEAVE_MS);

    expect(screen.queryByText('一')).not.toBeInTheDocument();
    expect(screen.getByText('四')).toBeInTheDocument();
  });

  it('操作按钮执行回调并关闭，dismissToast 按 key 关闭', () => {
    const onClick = jest.fn();
    render(<ToastViewport />);

    act(() => {
      showToast('有新版本', 'notice', {
        key: 'update',
        action: { label: '查看', onClick },
      });
      showToast('保存失败', 'error', { key: 'save' });
    });

    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    act(() => dismissToast('save'));
    advance(TOAST_LEAVE_MS);
    expect(screen.queryByText('有新版本')).not.toBeInTheDocument();
    expect(screen.queryByText('保存失败')).not.toBeInTheDocument();
  });

  it('指针停留时暂停计时', () => {
    render(<ToastViewport />);

    act(() => {
      showToast('已保存', 'success');
    });
    fireEvent.pointerEnter(screen.getByRole('list'));
    advance(10_000);
    expect(screen.getByText('已保存').closest('.toast-motion')).toHaveAttribute(
      'data-phase',
      'idle',
    );

    fireEvent.pointerLeave(screen.getByRole('list'));
    advance(2600 + TOAST_LEAVE_MS);
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });
});

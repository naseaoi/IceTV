import { act, fireEvent, render, screen } from '@testing-library/react';

import ModalShell, { useDeferredClose } from './ModalShell';

function DeferredPanel({ onClose }: { onClose: () => void }) {
  const [open, requestClose] = useDeferredClose(onClose);
  return (
    <ModalShell isOpen={open} onClose={requestClose}>
      <button type='button' onClick={requestClose}>
        关闭
      </button>
    </ModalShell>
  );
}

describe('ModalShell', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Esc 只关闭最上层弹窗', () => {
    const closeOuter = jest.fn();
    const closeInner = jest.fn();
    render(
      <ModalShell isOpen onClose={closeOuter}>
        外层
        <ModalShell isOpen onClose={closeInner}>
          内层
        </ModalShell>
      </ModalShell>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it('延迟关闭在退场结束后才通知父组件', () => {
    const onClose = jest.fn();
    render(<DeferredPanel onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(130);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

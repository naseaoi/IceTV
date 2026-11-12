import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

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

function SwitchingPanels() {
  const [panel, setPanel] = useState<'profile' | 'password' | null>(null);
  return (
    <>
      <button type='button' onClick={() => setPanel('profile')}>
        打开资料
      </button>
      {panel === 'profile' && (
        <ModalShell isOpen onClose={() => setPanel(null)}>
          <button type='button' onClick={() => setPanel('password')}>
            修改密码
          </button>
        </ModalShell>
      )}
      {panel === 'password' && (
        <ModalShell isOpen onClose={() => setPanel(null)}>
          密码表单
        </ModalShell>
      )}
    </>
  );
}

function backdrop() {
  return document.querySelector('.motion-backdrop');
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

  it('从一个弹窗直接切到另一个弹窗时压暗不中断，单独打开仍淡入', () => {
    render(<SwitchingPanels />);
    fireEvent.click(screen.getByRole('button', { name: '打开资料' }));
    expect(backdrop()).toHaveAttribute('data-open', 'false');
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(backdrop()).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByText('密码表单')).toBeInTheDocument();
    expect(document.querySelectorAll('.motion-backdrop')).toHaveLength(1);
    expect(backdrop()).toHaveAttribute('data-open', 'true');
  });
});

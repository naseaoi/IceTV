import { act, fireEvent, render, screen } from '@testing-library/react';

import ConfirmModal from '@/components/modals/ConfirmModal';

it('同步确认保持立即关闭', () => {
  const close = jest.fn();
  const confirm = jest.fn();
  render(
    <ConfirmModal isOpen title='删除' onClose={close} onConfirm={confirm} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  '异步确认期间禁止重复和关闭，成功=%s',
  async (success) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const confirm = jest.fn(
      () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    const close = jest.fn();
    render(
      <ConfirmModal isOpen title='删除' onClose={close} onConfirm={confirm} />,
    );
    const button = screen.getByRole('button', { name: '确认' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      if (success) resolve();
      else reject(new Error('failed'));
    });
    expect(close).toHaveBeenCalledTimes(success ? 1 : 0);
    expect(button).toBeEnabled();
  },
);

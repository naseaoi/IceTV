import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChangePasswordPanel } from './ChangePasswordPanel';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', username: 'linux_user' },
  }),
}));

jest.mock('@/components/modals/ModalShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDeferredClose: (onClose: () => void) => [true, onClose],
}));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('首次设置隐藏当前密码并提交后退出登录', async () => {
  const logout = jest.fn().mockResolvedValue(undefined);
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hasPassword: false }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  render(<ChangePasswordPanel onClose={jest.fn()} onLogout={logout} />);
  expect(
    await screen.findByRole('heading', { name: '设置密码' }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
  expect(screen.getByLabelText('用户名')).toHaveValue('linux_user');
  expect(screen.getByLabelText('用户名')).toHaveAttribute(
    'autocomplete',
    'username',
  );
  fireEvent.change(screen.getByLabelText('新密码'), {
    target: { value: 'first-password' },
  });
  fireEvent.change(screen.getByLabelText('确认新密码'), {
    target: { value: 'first-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: '设置并重新登录' }));
  await waitFor(() => expect(logout).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenLastCalledWith(
    '/api/change-password',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ oldPassword: '', newPassword: 'first-password' }),
    }),
  );
});

it('已有密码必须填写当前密码', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ hasPassword: true }) });
  render(<ChangePasswordPanel onClose={jest.fn()} onLogout={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('新密码')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('新密码'), {
    target: { value: 'next-password' },
  });
  fireEvent.change(screen.getByLabelText('确认新密码'), {
    target: { value: 'next-password' },
  });
  expect(screen.getByRole('button', { name: '修改并重新登录' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('当前密码'), {
    target: { value: 'old-password' },
  });
  expect(screen.getByRole('button', { name: '修改并重新登录' })).toBeEnabled();
});

it('状态读取失败保持禁止提交', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network'));
  render(<ChangePasswordPanel onClose={jest.fn()} onLogout={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '读取密码状态失败',
  );
  expect(screen.getByRole('button', { name: '修改并重新登录' })).toBeDisabled();
});

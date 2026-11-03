import { act, fireEvent, render, screen } from '@testing-library/react';

import { useAuthSession } from '@/components/AuthProvider';
import { ProfileForm } from '@/components/user-menu/ProfilePanel';
import { getMyProfile, updateProfile } from '@/lib/profile.client';

jest.mock('@/components/AuthProvider', () => ({ useAuthSession: jest.fn() }));
jest.mock('@/lib/profile.client', () => ({
  getMyProfile: jest.fn(),
  updateProfile: jest.fn(),
}));
const refresh = jest.fn().mockResolvedValue(undefined);
const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(useAuthSession).mockReturnValue({
    session: {
      status: 'authenticated',
      username: 'private-login',
      role: 'user',
      profileId: 'profileAlice',
      nickname: null,
    },
    refreshSession: refresh,
    isRefreshing: false,
  });
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ available: true }) });
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});
it('校验昵称并在保存成功后刷新会话', async () => {
  jest.mocked(updateProfile).mockResolvedValue({
    profileId: 'profileAlice',
    nickname: '光影旅人',
    favoritesPublic: false,
  });
  render(<ProfileForm required />);
  expect(
    screen.getByText('昵称会公开显示在评价和个人主页，登录名不会公开'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存资料' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('昵称'), {
    target: { value: '光影旅人' },
  });
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/profile/nickname-availability?'),
    expect.anything(),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));
  });
  expect(updateProfile).toHaveBeenCalledWith({ nickname: '光影旅人' });
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('加载真实收藏开关并一起保存，昵称冲突保持表单', async () => {
  jest.mocked(getMyProfile).mockResolvedValue({
    profileId: 'profileAlice',
    nickname: '光影旅人',
    favoritesPublic: true,
  });
  jest.mocked(updateProfile).mockRejectedValue(new Error('昵称已被使用'));
  await act(async () => {
    render(<ProfileForm />);
  });
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  const toggle = screen.getByRole('switch', { name: /公开我的收藏/ });
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(toggle);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));
  });
  expect(updateProfile).toHaveBeenCalledWith({
    nickname: '光影旅人',
    favoritesPublic: false,
  });
  expect(screen.getByRole('alert')).toHaveTextContent('昵称已被使用');
  expect(refresh).not.toHaveBeenCalled();
});

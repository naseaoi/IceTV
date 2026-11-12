import { act, fireEvent, render, screen } from '@testing-library/react';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { useAuthSession } from '@/components/AuthProvider';
import { ProfileForm } from '@/components/user-menu/ProfilePanel';
import { getMyProfile, updateProfile } from '@/lib/profile.client';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

jest.mock('@/components/AuthProvider', () => ({ useAuthSession: jest.fn() }));
jest.mock('@/lib/profile.client', () => ({
  getMyProfile: jest.fn(),
  updateProfile: jest.fn(),
}));
installCryptoPolyfill();
const refresh = jest.fn().mockResolvedValue(undefined);
const originalFetch = global.fetch;
const savedProfile = {
  profileId: 'profileAlice',
  nickname: '光影旅人',
  avatarSeed: null,
  libraryVisibility: 1 as const,
};
function mockSession(nickname: string | null) {
  jest.mocked(useAuthSession).mockReturnValue({
    session: {
      status: 'authenticated',
      username: 'private-login',
      role: 'user',
      profileId: 'profileAlice',
      nickname,
      avatarSeed: null,
    },
    refreshSession: refresh,
    isRefreshing: false,
  });
}
async function renderLoadedForm() {
  mockSession('光影旅人');
  jest.mocked(getMyProfile).mockResolvedValue(savedProfile);
  await act(async () => {
    render(<ProfileForm />);
  });
}
const saveButton = () => screen.getByRole('button', { name: '保存' });
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ available: true }) });
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});
it('首次设置昵称：检测可用后保存并刷新会话', async () => {
  mockSession(null);
  jest.mocked(updateProfile).mockResolvedValue(savedProfile);
  render(<ProfileForm required />);
  expect(saveButton()).toBeDisabled();
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
    fireEvent.click(saveButton());
  });
  expect(updateProfile).toHaveBeenCalledWith({ nickname: '光影旅人' });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith('个人资料已保存', 'success');
});
it('打开时不检测当前昵称，未改动不可保存', async () => {
  await renderLoadedForm();
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('');
  expect(saveButton()).toBeDisabled();
});
it('只提交改动的字段，保存失败保留表单', async () => {
  await renderLoadedForm();
  jest.mocked(updateProfile).mockRejectedValue(new Error('保存失败'));
  const select = screen.getByRole('button', { name: '收藏公开范围' });
  expect(select).toHaveTextContent('仅收藏');
  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: '不公开' }));
  await act(async () => {
    fireEvent.click(saveButton());
  });
  expect(updateProfile).toHaveBeenCalledWith({ libraryVisibility: 0 });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
  expect(refresh).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
});
it('选择候选头像后保存头像种子，选回当前头像则无改动', async () => {
  await renderLoadedForm();
  jest.mocked(updateProfile).mockResolvedValue(savedProfile);
  fireEvent.click(screen.getByRole('radio', { name: '候选头像 1' }));
  expect(saveButton()).toBeEnabled();
  fireEvent.click(screen.getByRole('radio', { name: '当前头像' }));
  expect(saveButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: '候选头像 2' }));
  await act(async () => {
    fireEvent.click(saveButton());
  });
  expect(updateProfile).toHaveBeenCalledWith({
    avatarSeed: expect.stringMatching(/^[a-z0-9]{16}$/),
  });
});
it('换一批保留已选中的候选头像', async () => {
  await renderLoadedForm();
  const picked = screen.getByRole('radio', { name: '候选头像 3' });
  fireEvent.click(picked);
  const before = picked.innerHTML;
  fireEvent.click(screen.getByRole('button', { name: '换一批头像' }));
  const after = screen.getByRole('radio', { name: '候选头像 3' });
  expect(after).toHaveAttribute('aria-checked', 'true');
  expect(after.innerHTML).toBe(before);
});

it('可以选择收藏、状态与评分并保存数字等级', async () => {
  await renderLoadedForm();
  jest
    .mocked(updateProfile)
    .mockResolvedValue({ ...savedProfile, libraryVisibility: 3 });
  fireEvent.click(screen.getByRole('button', { name: '收藏公开范围' }));
  fireEvent.click(screen.getByRole('option', { name: '收藏、状态与评分' }));
  await act(async () => {
    fireEvent.click(saveButton());
  });
  expect(updateProfile).toHaveBeenCalledWith({ libraryVisibility: 3 });
});

it('个人主页入口保存资料后不重复提示成功', async () => {
  mockSession('光影旅人');
  jest.mocked(getMyProfile).mockResolvedValue(savedProfile);
  jest.mocked(updateProfile).mockResolvedValue(savedProfile);
  const onSaved = jest.fn();
  await act(async () => {
    render(<ProfileForm showSuccessToast={false} onSaved={onSaved} />);
  });
  fireEvent.click(screen.getByRole('radio', { name: '候选头像 1' }));
  await act(async () => {
    fireEvent.click(saveButton());
  });
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(showToast).not.toHaveBeenCalled();
});

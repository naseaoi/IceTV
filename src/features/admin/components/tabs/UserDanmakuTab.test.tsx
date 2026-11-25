import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import UserDanmakuTab from '@/features/admin/components/tabs/UserDanmakuTab';
import { adminDelete, adminGet } from '@/features/admin/lib/api';
import { rememberAdminListCount } from '@/features/admin/lib/list-counts';
import { showToast } from '@/lib/toast';
import { ADMIN_USER_DANMAKU_DELETE_LIMIT } from '@/lib/user-danmaku';

jest.mock('@/features/admin/lib/api', () => ({
  adminGet: jest.fn(),
  adminDelete: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

it('每批成功立即移除，后续失败保留剩余选中项并可重试', async () => {
  const size = ADMIN_USER_DANMAKU_DELETE_LIMIT;
  jest.mocked(adminGet).mockResolvedValue({
    items: Array.from({ length: size + 1 }, (_, i) => ({
      id: String(i),
      username: 'demo',
      text: `弹幕${i}`,
      time: 1,
      episodeKey: '1',
      createdAt: Date.now(),
    })),
    nextCursor: null,
  });
  let rejectSecond!: (error: Error) => void;
  jest
    .mocked(adminDelete)
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSecond = reject;
        }),
    )
    .mockResolvedValue(undefined);
  render(<UserDanmakuTab />);
  await screen.findByText('弹幕0');
  expect(screen.getByText(`共 ${size + 1} 条`)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('全选'));
  expect(screen.getByText(`已选 ${size + 1} 条`)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(adminDelete).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('弹幕0')).not.toBeInTheDocument();
  expect(screen.getByText(`弹幕${size}`)).toBeInTheDocument();
  await act(async () => {
    rejectSecond(new Error('failed'));
  });
  expect(showToast).toHaveBeenCalledWith(
    `已删除 ${size} 条，1 条未删除`,
    'error',
  );
  expect(screen.getByText('已选 1 条')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() =>
    expect(adminDelete).toHaveBeenLastCalledWith(
      '/api/admin/danmaku/user',
      { ids: [String(size)] },
      '删除弹幕失败',
    ),
  );
});

it('未知弹幕条数转圈，搜索期间用查找动画，空结果结束后展示空状态', async () => {
  rememberAdminListCount('danmaku', undefined);
  jest.mocked(adminGet).mockResolvedValue({ items: [], nextCursor: null });
  render(<UserDanmakuTab />);
  expect(
    screen
      .getByRole('status', { name: '加载中' })
      .querySelector('.ice-spinner'),
  ).toBeInTheDocument();
  await screen.findByText('还没有用户发送弹幕');
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: '不存在' },
  });
  expect(screen.getByRole('status', { name: '正在搜索' })).toBeInTheDocument();
  await screen.findByText('没有匹配的弹幕');
  expect(
    screen.queryByRole('status', { name: '正在搜索' }),
  ).not.toBeInTheDocument();
});

import { act, render, screen } from '@testing-library/react';

import { ListPickerModal } from '@/features/lists/components/ListPickerModal';
import { ProfileLists } from '@/features/lists/components/ProfileLists';
import {
  fetchMyLists,
  fetchProfileLists,
} from '@/features/lists/lib/lists-client';
import {
  clearListCountCookie,
  writeListCountCookie,
} from '@/lib/list-count-cookies';

jest.mock('@/features/lists/lib/lists-client', () => ({
  fetchMyLists: jest.fn(),
  fetchProfileLists: jest.fn(),
  createList: jest.fn(),
  addListItem: jest.fn(),
  removeListItem: jest.fn(),
}));

const target = { source: 'source', id: 'video', title: '作品', cover: '' };

beforeEach(() => {
  jest
    .mocked(fetchMyLists)
    .mockImplementation(() => new Promise(() => undefined));
  jest
    .mocked(fetchProfileLists)
    .mockImplementation(() => new Promise(() => undefined));
  clearListCountCookie('list_count');
});
afterEach(() => clearListCountCookie('list_count'));

it('加入片单未知数量转圈，已知数量沿用本人片单计数', () => {
  const { unmount } = render(
    <ListPickerModal target={target} onClose={jest.fn()} />,
  );
  expect(screen.getByRole('status', { name: '加载片单' })).toHaveClass(
    'ice-spinner',
  );
  unmount();
  writeListCountCookie('list_count', 2);
  render(<ListPickerModal target={target} onClose={jest.fn()} />);
  expect(screen.getByRole('status', { name: '加载中' }).children).toHaveLength(
    2,
  );
});

it('加入片单零条时占位创建表单，接口返回后自动打开创建入口', async () => {
  writeListCountCookie('list_count', 0);
  let resolve!: (value: []) => void;
  jest.mocked(fetchMyLists).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<ListPickerModal target={target} onClose={jest.fn()} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('textbox', { name: '片单名称' })).toBeNull();
  const placeholder = document.querySelector('[aria-hidden="true"].px-1');
  expect(placeholder?.querySelectorAll('.skeleton')).toHaveLength(2);
  const classes = placeholder?.className.split(' ') ?? [];
  await act(async () => resolve([]));
  const form = screen
    .getByRole('textbox', { name: '片单名称' })
    .closest('form');
  expect(form).toHaveClass(...classes);
});

it('个人主页片单按已知条数加载', () => {
  render(<ProfileLists profileId='profile' isSelf={false} skeletonCount={2} />);
  expect(screen.getByRole('status', { name: '加载中' }).children).toHaveLength(
    2,
  );
});

it('个人主页零条计数先占位，实际空状态与骨架共用留白', async () => {
  let resolve!: (value: []) => void;
  jest.mocked(fetchProfileLists).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { container } = render(
    <ProfileLists profileId='profile' isSelf={false} skeletonCount={0} />,
  );
  expect(screen.queryByText('暂无公开片单')).toBeNull();
  expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument();
  const classes = container.firstElementChild!.className.split(' ');
  await act(async () => resolve([]));
  expect(screen.getByText('暂无公开片单').parentElement).toHaveClass(
    ...classes,
  );
});

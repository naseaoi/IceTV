import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import {
  fetchMyLists,
  fetchSavedLists,
  setListLiked,
} from '@/features/lists/lib/lists-client';
import type {
  ListLikeState,
  ListSummary,
  SavedListSummary,
} from '@/features/lists/types';
import {
  clearListCountCookie,
  readListCountCookie,
  writeListCountCookie,
} from '@/lib/list-count-cookies';
import { showToast } from '@/lib/toast';
import { DisplayableError } from '@/lib/user-facing-error';

import { MyListsPageClient, MyListsPageSkeleton } from './MyListsPageClient';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock('@/features/lists/lib/lists-client', () => ({
  fetchMyLists: jest.fn(),
  fetchSavedLists: jest.fn(),
  setListLiked: jest.fn(),
  createList: jest.fn(),
}));
jest.mock('./ListFormDialog', () => ({
  ListFormDialog: () => null,
  NEW_LIST_VALUES: {},
}));
jest.mock('@/components/ProfileAvatar', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

const created: ListSummary = {
  id: 'created',
  name: '创建的片单',
  description: '',
  visibility: 'members',
  itemCount: 1,
  viewCount: 0,
  likeCount: 0,
  covers: [],
  version: 1,
  updatedAt: 0,
};
const owner = { profileId: 'author', nickname: '片单作者', avatarSeed: null };
const saved: SavedListSummary[] = [
  {
    ...created,
    id: 'available',
    name: '可读片单',
    status: 'available',
    owner,
    savedAt: 3,
  },
  { id: 'private', name: '私密快照', status: 'private', savedAt: 2 },
  { id: 'deleted', name: '删除快照', status: 'deleted', savedAt: 1 },
];

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/me/lists');
  clearListCountCookie('list_count');
  clearListCountCookie('saved_list_count');
  jest.mocked(fetchMyLists).mockResolvedValue([created]);
  jest.mocked(fetchSavedLists).mockResolvedValue(saved);
});

it('标签写入 URL，计数和新建入口跟随标签，历史返回恢复创建标签', async () => {
  const page = <MyListsPageClient skeletonCount={1} savedSkeletonCount={3} />;
  const { rerender } = render(page);
  await screen.findByRole('link', { name: /创建的片单/ });
  expect(screen.getByRole('button', { name: /^创建的/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: '新建片单' })).toBeEnabled();
  expect(readListCountCookie('list_count')).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: /^收藏的/ }));
  expect(window.location.search).toBe('?tab=saved');
  // Next 的 useSearchParams 在原生 History 更新后发布新快照。
  rerender(<MyListsPageClient skeletonCount={1} savedSkeletonCount={3} />);
  await screen.findByRole('link', { name: /可读片单/ });
  expect(screen.queryByRole('button', { name: '新建片单' })).toBeNull();
  expect(screen.getByRole('button', { name: /^收藏的/ })).toHaveTextContent(
    '收藏的3',
  );
  expect(screen.getByRole('button', { name: /^创建的/ })).toHaveTextContent(
    '创建的1',
  );
  expect(
    within(screen.getByRole('link', { name: /可读片单/ })).getByText(
      '片单作者',
    ),
  ).toBeInTheDocument();
  expect(readListCountCookie('saved_list_count')).toBe(3);
  await act(async () => {
    const back = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    window.history.back();
    await back;
  });
  rerender(<MyListsPageClient skeletonCount={1} savedSkeletonCount={3} />);
  expect(screen.getByRole('button', { name: /^创建的/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('link', { name: /创建的片单/ })).toBeInTheDocument();
});

it('收藏直链展示失效快照且不可跳转，取消收藏乐观移除并更新计数', async () => {
  window.history.replaceState(null, '', '/me/lists?tab=saved');
  let resolve!: (value: ListLikeState) => void;
  jest.mocked(setListLiked).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<MyListsPageClient savedSkeletonCount={3} />);
  const deleted = await screen.findByRole('article', { name: '删除快照' });
  expect(within(deleted).getByText('作者已删除')).toBeInTheDocument();
  expect(within(deleted).queryByRole('link')).toBeNull();
  expect(
    within(screen.getByRole('article', { name: '私密快照' })).getByText(
      '作者暂不公开',
    ),
  ).toBeInTheDocument();
  fireEvent.click(
    within(deleted).getByRole('button', { name: '取消收藏「删除快照」' }),
  );
  expect(screen.queryByRole('article', { name: '删除快照' })).toBeNull();
  expect(readListCountCookie('saved_list_count')).toBe(3);
  expect(setListLiked).toHaveBeenCalledWith('deleted', false);
  jest
    .mocked(fetchSavedLists)
    .mockResolvedValue(saved.filter((item) => item.id !== 'deleted'));
  await act(async () => resolve({ liked: false, likeCount: 0 }));
  expect(screen.queryByRole('article', { name: '删除快照' })).toBeNull();
  expect(readListCountCookie('saved_list_count')).toBe(2);
  expect(fetchSavedLists).toHaveBeenCalledTimes(2);
});

it('取消收藏失败恢复卡片、顺序和计数并显示错误', async () => {
  window.history.replaceState(null, '', '/me/lists?tab=saved');
  jest
    .mocked(setListLiked)
    .mockRejectedValue(new DisplayableError('取消收藏失败'));
  render(<MyListsPageClient />);
  await screen.findByRole('article', { name: '私密快照' });
  await act(async () =>
    fireEvent.click(
      screen.getByRole('button', { name: '取消收藏「私密快照」' }),
    ),
  );
  expect(
    screen
      .getAllByRole('article')
      .map((entry) => entry.getAttribute('aria-label')),
  ).toEqual(['私密快照', '删除快照']);
  expect(readListCountCookie('saved_list_count')).toBe(3);
  expect(showToast).toHaveBeenCalledWith('取消收藏失败', 'error');
});

it('重复取消返回 404 时保持移除并静默补入窗口下一条', async () => {
  window.history.replaceState(null, '', '/me/lists?tab=saved');
  jest
    .mocked(setListLiked)
    .mockRejectedValue(new DisplayableError('记录已不存在', { status: 404 }));
  render(<MyListsPageClient />);
  await screen.findByRole('article', { name: '删除快照' });
  let refresh!: (value: SavedListSummary[]) => void;
  writeListCountCookie('saved_list_count', 501);
  jest.mocked(fetchSavedLists).mockReturnValue(
    new Promise((resolve) => {
      refresh = resolve;
    }),
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole('button', { name: '取消收藏「删除快照」' }),
    ),
  );
  expect(screen.queryByRole('article', { name: '删除快照' })).toBeNull();
  expect(screen.getByRole('link', { name: /可读片单/ })).toBeInTheDocument();
  expect(screen.queryByRole('status')).toBeNull();
  expect(readListCountCookie('saved_list_count')).toBe(501);
  await act(async () =>
    refresh([
      ...saved.filter((item) => item.id !== 'deleted'),
      {
        ...created,
        id: 'next',
        name: '窗口下一条',
        status: 'available',
        owner,
        savedAt: 0,
      },
    ]),
  );
  expect(screen.getByRole('link', { name: /窗口下一条/ })).toBeInTheDocument();
  expect(showToast).not.toHaveBeenCalled();
  expect(readListCountCookie('saved_list_count')).toBe(3);
});

it('收藏为空时显示广场入口，零条占位与空状态共用留白', async () => {
  window.history.replaceState(null, '', '/me/lists?tab=saved');
  let resolve!: (value: SavedListSummary[]) => void;
  jest.mocked(fetchSavedLists).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<MyListsPageClient savedSkeletonCount={0} />);
  const frame = screen.getByRole('status', { name: '加载中' }).parentElement!;
  expect(screen.queryByText('还没有收藏的片单')).toBeNull();
  await act(async () => resolve([]));
  expect(
    screen.getByText('还没有收藏的片单').parentElement?.parentElement,
  ).toHaveClass(...frame.className.split(' '));
  expect(screen.getByRole('link', { name: '去片单广场' })).toHaveAttribute(
    'href',
    '/lists',
  );
  expect(readListCountCookie('saved_list_count')).toBe(0);
});

it('两个标签按各自计数生成骨架，未知条数转圈', () => {
  const { rerender } = render(
    <MyListsPageSkeleton skeletonCount={2} savedSkeletonCount={3} />,
  );
  expect(screen.getByRole('status', { name: '加载中' }).children).toHaveLength(
    2,
  );
  window.history.replaceState(null, '', '/me/lists?tab=saved');
  rerender(<MyListsPageSkeleton skeletonCount={2} savedSkeletonCount={3} />);
  expect(screen.getByRole('status', { name: '加载中' }).children).toHaveLength(
    3,
  );
  rerender(<MyListsPageSkeleton savedSkeletonCount={null} />);
  expect(
    screen
      .getByRole('status', { name: '加载中' })
      .querySelector('.ice-spinner'),
  ).not.toBeNull();
});

it('未激活标签显示 Cookie 计数，已加载标签使用实际条数', async () => {
  writeListCountCookie('saved_list_count', 7);
  render(<MyListsPageClient skeletonCount={4} />);
  await screen.findByRole('link', { name: /创建的片单/ });
  expect(screen.getByRole('button', { name: /^创建的/ })).toHaveTextContent(
    '创建的1',
  );
  expect(screen.getByRole('button', { name: /^收藏的/ })).toHaveTextContent(
    '收藏的7',
  );
  expect(fetchSavedLists).not.toHaveBeenCalled();
});

it('药丸计数未知时占位，已知计数直接显示', () => {
  render(<MyListsPageSkeleton skeletonCount={2} savedSkeletonCount={null} />);
  const createdPill = screen.getByRole('button', { name: /^创建的/ });
  const savedPill = screen.getByRole('button', { name: /^收藏的/ });
  expect(createdPill).toHaveTextContent('创建的2');
  expect(createdPill.querySelector('.skeleton')).toBeNull();
  expect(
    savedPill.querySelector('[aria-hidden="true"] .skeleton'),
  ).not.toBeNull();
});

it('收藏读取失败展示重试，重试成功后展示结果', async () => {
  window.history.replaceState(null, '', '/me/lists?tab=saved');
  jest
    .mocked(fetchSavedLists)
    .mockRejectedValueOnce(new DisplayableError('加载失败'));
  render(<MyListsPageClient />);
  expect(await screen.findByRole('alert')).toHaveTextContent('加载失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('link', { name: /可读片单/ });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

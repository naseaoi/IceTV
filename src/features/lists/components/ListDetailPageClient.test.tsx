import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { fetchList } from '@/features/lists/lib/lists-client';
import type { ListDetail } from '@/features/lists/types';

import { ListDetailPageClient } from './ListDetailPageClient';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('@/hooks/useBackNavigation', () => ({
  useBackNavigation: () => jest.fn(),
}));
jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: jest.fn(),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ProfileAvatar', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('./ListFormDialog', () => ({ ListFormDialog: () => null }));
jest.mock('./ListItemCard', () => ({
  ListItemCard: () => null,
  EditableListItemCard: () => null,
  ListItemGridSkeleton: () => null,
}));
jest.mock('@/features/lists/lib/lists-client', () => ({
  fetchList: jest.fn(),
  peekListSummary: jest.fn(() => null),
  deleteList: jest.fn(),
  removeListItem: jest.fn(),
  reorderListItems: jest.fn(),
  updateList: jest.fn(),
  setListLiked: jest.fn(),
}));

function makeDetail(): ListDetail {
  return {
    list: {
      id: 'list',
      name: '片单',
      description: '',
      visibility: 'everyone',
      itemCount: 4,
      viewCount: 8,
      likeCount: 2,
      covers: [],
      version: 1,
      updatedAt: Date.now(),
    },
    owner: { profileId: 'author', nickname: '作者', avatarSeed: null },
    isOwner: false,
    liked: false,
    items: [
      {
        id: 'next',
        title: '下一部作品',
        year: '2026',
        cover: '',
        source: '',
        sourceId: null,
        searchTitle: '',
        addedAt: 0,
        viewerStatus: null,
      },
    ],
    viewerProgress: { completed: 0, total: 4, nextItemId: 'next' },
  };
}

beforeEach(() => {
  jest.mocked(useAuthSession).mockReturnValue({
    session: { status: 'authenticated' },
  } as ReturnType<typeof useAuthSession>);
});

async function renderDetail(detail: ListDetail) {
  jest.mocked(fetchList).mockResolvedValue(detail);
  render(<ListDetailPageClient listId='list' initialPreview={null} />);
  await screen.findByRole('link', { name: '作者' });
}

it.each([
  { completed: 0, watching: false, label: '开始看' },
  { completed: 1, watching: false, label: '看下一部' },
  { completed: 1, watching: true, label: '继续看' },
])(
  '进度在作者信息行出现，主按钮为 $label',
  async ({ completed, watching, label }) => {
    const detail = makeDetail();
    detail.viewerProgress!.completed = completed;
    detail.items[0].viewerStatus = watching ? 'watching' : null;
    await renderDetail(detail);
    const metadata = screen.getByRole('link', { name: '作者' }).parentElement!;
    expect(
      within(metadata).getByLabelText(`已看 ${completed} 部，共 4 部`),
    ).toHaveTextContent(`已看 ${completed}/4 部`);
    expect(within(metadata).getByLabelText('2 人收藏')).toHaveAttribute(
      'title',
      '收藏',
    );
    const play = screen.getByRole('link', { name: label });
    expect(play).toHaveAttribute('href', expect.stringContaining('/play'));
    expect(play.parentElement).not.toContainElement(
      screen.getByLabelText(`已看 ${completed} 部，共 4 部`),
    );
  },
);

it('全部看完时信息行展示满圈，作者操作行从图标按钮开始', async () => {
  const detail = makeDetail();
  detail.isOwner = true;
  detail.viewerProgress = { completed: 4, total: 4, nextItemId: null };
  await renderDetail(detail);
  const progress = screen.getByLabelText('已看 4 部，共 4 部');
  expect(progress).toHaveTextContent('已看完 4/4');
  expect(progress.querySelector('[stroke-dashoffset]')).toHaveAttribute(
    'stroke-dashoffset',
    '0',
  );
  const copy = screen.getByRole('button', { name: '复制片单链接' });
  expect(copy.parentElement?.firstElementChild).toBe(copy);
  expect(copy.parentElement).toHaveClass('-ml-2.5');
});

it('游客无进度时展示片单部数', async () => {
  jest.mocked(useAuthSession).mockReturnValue({
    session: { status: 'guest' },
  } as ReturnType<typeof useAuthSession>);
  const detail = makeDetail();
  delete detail.viewerProgress;
  await renderDetail(detail);
  const metadata = screen.getByRole('link', { name: '作者' }).parentElement!;
  expect(within(metadata).getByText('4 部')).toBeInTheDocument();
  expect(within(metadata).queryByLabelText(/已看 .* 部，共/)).toBeNull();
});

it('空片单沿用零部计数', async () => {
  const detail = makeDetail();
  detail.items = [];
  detail.list.itemCount = 0;
  detail.viewerProgress = { completed: 0, total: 0, nextItemId: null };
  await renderDetail(detail);
  expect(screen.getByText('0 部')).toBeInTheDocument();
  expect(screen.getByText('片单还是空的')).toBeInTheDocument();
});

it('编辑条目时信息行恢复部数，退出编辑恢复进度', async () => {
  const detail = makeDetail();
  detail.isOwner = true;
  await renderDetail(detail);
  fireEvent.click(screen.getByRole('button', { name: '片单操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '排序与移出' }));
  const metadata = screen.getByRole('link', { name: '作者' }).parentElement!;
  expect(within(metadata).getByText('4 部')).toBeInTheDocument();
  expect(within(metadata).queryByLabelText('已看 0 部，共 4 部')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(
    within(metadata).getByLabelText('已看 0 部，共 4 部'),
  ).toBeInTheDocument();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FavoritesPageClient } from '@/features/favorites/components/FavoritesPageClient';
import type { FavoriteItem } from '@/features/favorites/types';

const mockBatch = jest.fn();
const mockBind = jest.fn();
jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', profileId: 'alice' },
  }),
}));
const mockRetry = jest.fn();
let mockRefreshing = false;
let mockError: string | null = null;

jest.mock('@/lib/db.client', () => ({
  batchFavorites: (...args: unknown[]) => mockBatch(...args),
  bindCatalogFavorites: (...args: unknown[]) => mockBind(...args),
}));
jest.mock('@/components/LibraryPage', () => ({
  LIBRARY_PILL_BUTTON_CLASS: '',
  LibraryEmptySkeleton: () => null,
  LibraryEmptyState: () => null,
  LibraryPageFrame: ({
    toolbar,
    children,
  }: {
    toolbar: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {toolbar}
      {children}
    </div>
  ),
}));
jest.mock('@/features/favorites/components/FavoriteLibraryToolbar', () => ({
  EMPTY_FAVORITE_COUNTS: {},
  FavoriteLibraryToolbar: ({ action }: { action: React.ReactNode }) => (
    <div>{action}</div>
  ),
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

const items: FavoriteItem[] = ['a', 'b', 'c'].map((id) => ({
  id,
  source: 'src',
  title: `作品${id}`,
  poster: '',
  episodes: 1,
  source_name: '源',
}));

jest.mock('@/features/favorites/hooks/useFavoriteLibrary', () => ({
  useFavoriteLibrary: () => ({
    items,
    loading: false,
    refreshing: mockRefreshing,
    loadingMore: false,
    error: mockError,
    retry: mockRetry,
    skeletonCount: 3,
    clearFavorites: jest.fn(),
    counts: {},
    total: 3,
    libraryTotal: 3,
    hasMore: false,
    loadMore: jest.fn(),
  }),
}));

beforeEach(() => {
  mockRetry.mockReset();
  mockRefreshing = false;
  mockError = null;
  mockBatch.mockReset().mockResolvedValue({ affected: 1 });
});

it('刷新时列表设置 inert，结束后恢复交互', () => {
  mockRefreshing = true;
  const { container, rerender } = render(<FavoritesPageClient />);
  expect(container.querySelector('[aria-busy="true"]')).toHaveAttribute(
    'inert',
  );
  expect(container.querySelector('[inert]')).toHaveClass('opacity-60');
  mockRefreshing = false;
  rerender(<FavoritesPageClient />);
  expect(container.querySelector('[inert]')).toBeNull();
});

it('保留旧列表且没有下一页时仍显示错误并可重试', () => {
  mockError = '收藏加载失败，请重试';
  render(<FavoritesPageClient />);
  expect(screen.getByText('作品a')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(mockError);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(mockRetry).toHaveBeenCalledTimes(1);
});

it('批量设置选中作品的状态后清空选择', async () => {
  render(<FavoritesPageClient />);
  fireEvent.click(screen.getByRole('button', { name: '多选' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '作品b' }));
  expect(screen.getByText('已选 1 部')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '看过' }));
  await waitFor(() =>
    expect(mockBatch).toHaveBeenCalledWith({
      action: 'set-status',
      target: { keys: ['src+b'] },
      watchStatus: 'completed',
    }),
  );
  expect(await screen.findByText('已选 0 部')).toBeInTheDocument();
});

it('全选后按当前筛选提交并带上排除项，移出前先确认', async () => {
  render(<FavoritesPageClient />);
  fireEvent.click(screen.getByRole('button', { name: '多选' }));
  fireEvent.click(screen.getByRole('button', { name: '全选' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '作品a' }));
  expect(screen.getByText('已选 2 部')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '移出' }));
  expect(mockBatch).not.toHaveBeenCalled();
  const confirmButtons = await screen.findAllByRole('button', { name: '移出' });
  expect(confirmButtons).toHaveLength(2);
  fireEvent.click(confirmButtons[1]);
  await waitFor(() =>
    expect(mockBatch).toHaveBeenCalledWith({
      action: 'remove',
      target: { match: { q: '', filter: 'all' }, exclude: ['src+a'] },
    }),
  );
});

it('批量失败时保留选择并提示', async () => {
  mockBatch.mockRejectedValueOnce(new Error('boom'));
  render(<FavoritesPageClient />);
  fireEvent.click(screen.getByRole('button', { name: '多选' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '作品c' }));
  fireEvent.click(screen.getByRole('button', { name: /自动/ }));
  expect(await screen.findByText('操作失败，请重试')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '作品c' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

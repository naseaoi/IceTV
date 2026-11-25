import { act, fireEvent, render, screen } from '@testing-library/react';

import { cacheManager } from '@/lib/db.client.cache';

import SearchHistory from './SearchHistory';
import { SearchHistorySkeleton } from './SearchPageSkeleton';

jest.mock('@/lib/db.client.cache', () => ({
  cacheManager: { getCachedSearchHistory: jest.fn(() => null) },
}));

const push = jest.fn();
const deleteSearchHistory = jest.fn().mockResolvedValue(undefined);

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('@/lib/db.client', () => ({
  clearSearchHistory: jest.fn().mockResolvedValue(undefined),
  deleteSearchHistory: (item: string) => deleteSearchHistory(item),
}));

jest.mock('@/features/search/hooks/useSearchExecution', () => ({
  clearSearchSnapshotCache: jest.fn(),
}));

jest.mock('@/components/modals/ConfirmModal', () => ({
  __esModule: true,
  default: () => null,
}));

function touch(element: HTMLElement, type: 'start' | 'end') {
  if (type === 'start') {
    fireEvent.touchStart(element, { touches: [{ clientX: 0, clientY: 0 }] });
  } else {
    fireEvent.touchEnd(element);
  }
}

describe('SearchHistory', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    push.mockClear();
    deleteSearchHistory.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('long press enters delete mode where taps delete items', () => {
    render(
      <SearchHistory
        searchHistory={['进击的巨人', '芙莉莲']}
        setSearchQuery={jest.fn()}
      />,
    );

    const chip = screen.getByText('进击的巨人').closest('button')!;
    touch(chip, 'start');
    act(() => {
      jest.advanceTimersByTime(600);
    });
    touch(chip, 'end');

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();

    const other = screen.getByRole('button', { name: '删除搜索历史 芙莉莲' });
    touch(other, 'start');
    touch(other, 'end');
    expect(deleteSearchHistory).toHaveBeenCalledWith('芙莉莲');

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(
      screen.queryByRole('button', { name: '完成' }),
    ).not.toBeInTheDocument();
  });

  it('short tap searches the item', () => {
    render(
      <SearchHistory searchHistory={['芙莉莲']} setSearchQuery={jest.fn()} />,
    );

    const chip = screen.getByText('芙莉莲').closest('button')!;
    touch(chip, 'start');
    touch(chip, 'end');

    expect(push).toHaveBeenCalledWith(
      `/search?q=${encodeURIComponent('芙莉莲')}`,
    );
    expect(deleteSearchHistory).not.toHaveBeenCalled();
  });
});

describe('搜索历史加载条数', () => {
  afterEach(() => jest.mocked(cacheManager.getCachedSearchHistory).mockReset());

  it('未知时转圈，已知空缓存时不占位', () => {
    const { container, unmount } = render(<SearchHistorySkeleton />);
    expect(screen.getByRole('status', { name: '加载搜索历史' })).toHaveClass(
      'ice-spinner',
    );
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0);
    unmount();
    jest.mocked(cacheManager.getCachedSearchHistory).mockReturnValue([]);
    const empty = render(<SearchHistorySkeleton />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it('按缓存条数占位，显式已知条数优先', () => {
    jest
      .mocked(cacheManager.getCachedSearchHistory)
      .mockReturnValue(['一', '二']);
    const { container, rerender } = render(<SearchHistorySkeleton />);
    expect(container.querySelectorAll('.flex-wrap > .skeleton')).toHaveLength(
      2,
    );
    rerender(<SearchHistorySkeleton count={1} />);
    expect(container.querySelectorAll('.flex-wrap > .skeleton')).toHaveLength(
      1,
    );
    rerender(<SearchHistorySkeleton count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('历史组件加载时沿用已知列表条数', () => {
    const { container } = render(
      <SearchHistory
        loading
        searchHistory={['一', '二', '三']}
        setSearchQuery={jest.fn()}
      />,
    );
    expect(container.querySelectorAll('.flex-wrap > .skeleton')).toHaveLength(
      3,
    );
  });
});

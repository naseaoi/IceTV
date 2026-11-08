import { act, fireEvent, render, screen } from '@testing-library/react';

import SearchHistory from './SearchHistory';

const push = jest.fn();
const deleteSearchHistory = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('@/lib/db.client', () => ({
  clearSearchHistory: jest.fn(),
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

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import SearchBox from './SearchBox';

const push = jest.fn();
const getSearchHistory = jest.fn();
const deleteSearchHistory = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('@/lib/db.client', () => ({
  getSearchHistory: () => getSearchHistory(),
  deleteSearchHistory: (item: string) => deleteSearchHistory(item),
  subscribeToDataUpdates: () => () => undefined,
}));

const HISTORY = Array.from({ length: 10 }, (_, index) => `历史${index + 1}`);

function Harness({ showHistory }: { showHistory?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <SearchBox
      variant='nav'
      value={value}
      onValueChange={setValue}
      showHistory={showHistory}
    />
  );
}

async function focusInput() {
  await act(async () => {
    fireEvent.focus(screen.getByRole('searchbox', { name: '搜索影片' }));
  });
}

describe('SearchBox history dropdown', () => {
  beforeEach(() => {
    push.mockClear();
    deleteSearchHistory.mockClear();
    getSearchHistory.mockReset().mockResolvedValue(HISTORY);
  });

  it('loads history on first focus and limits the visible items', async () => {
    render(<Harness />);
    expect(getSearchHistory).not.toHaveBeenCalled();

    await focusInput();

    expect(getSearchHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText('历史8')).toBeInTheDocument();
    expect(screen.queryByText('历史9')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看全部 10 条' }));
    expect(screen.getByText('历史10')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /查看全部/ }),
    ).not.toBeInTheDocument();
  });

  it('deletes a single item and searches a selected item', async () => {
    render(<Harness />);
    await focusInput();

    fireEvent.click(screen.getByRole('button', { name: '删除搜索历史 历史2' }));
    expect(deleteSearchHistory).toHaveBeenCalledWith('历史2');

    fireEvent.click(screen.getByText('历史3'));
    expect(push).toHaveBeenCalledWith(
      `/search?q=${encodeURIComponent('历史3')}`,
    );
  });

  it('hides history while typing and when disabled', async () => {
    const { unmount } = render(<Harness />);
    await focusInput();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '进击' },
    });
    expect(screen.queryByText('历史1')).not.toBeInTheDocument();
    unmount();

    render(<Harness showHistory={false} />);
    await focusInput();
    expect(getSearchHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('历史1')).not.toBeInTheDocument();
  });
});

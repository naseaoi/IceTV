import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { getPageScrollTop, scrollPageTo } from '@/hooks/usePageScroll';
import { getDoubanCategories } from '@/lib/douban.client';

jest.mock('@/features/bangumi/lib/bangumi.client', () => ({
  GetBangumiCalendarDataWithMeta: jest.fn(),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(),
  getDoubanList: jest.fn(),
  getDoubanRecommends: jest.fn(),
}));

jest.mock('@/hooks/usePageScroll', () => ({
  getPageScrollTop: jest.fn(),
  scrollPageTo: jest.fn(),
}));

function FeedProbe() {
  const { doubanData, loading, loadNextPage, handleSecondaryChange } =
    useDoubanFeed('movie');

  return (
    <div>
      <span data-testid='ids'>
        {doubanData.map((item) => item.id).join(',')}
      </span>
      <span data-testid='loading'>{String(loading)}</span>
      <button onClick={loadNextPage}>下一页</button>
      <button onClick={() => handleSecondaryChange('华语')}>华语</button>
    </div>
  );
}

const firstPage = {
  code: 200,
  message: 'ok',
  list: [{ id: 'a', title: 'a', poster: '', rate: '', year: '' }],
};

describe('useDoubanFeed scroll on query change', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows a fresh load at the top after switching filters, not when paging', async () => {
    (getDoubanCategories as jest.Mock)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({ ...firstPage, list: [] })
      .mockReturnValueOnce(new Promise(() => undefined));
    (getPageScrollTop as jest.Mock).mockReturnValue(1200);

    render(<FeedProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^a$/),
    );

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(getDoubanCategories).toHaveBeenCalledTimes(2));
    expect(scrollPageTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '华语' }));

    expect(scrollPageTo).toHaveBeenCalledWith(0);
    expect(screen.getByTestId('ids')).toBeEmptyDOMElement();
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });
});

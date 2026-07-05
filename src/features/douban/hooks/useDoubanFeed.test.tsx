import { render, screen, waitFor } from '@testing-library/react';

import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { getDoubanCategories } from '@/lib/douban.client';

jest.mock('@/features/bangumi/lib/bangumi.client', () => ({
  GetBangumiCalendarData: jest.fn(),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(),
  getDoubanList: jest.fn(),
  getDoubanRecommends: jest.fn(),
}));

function DoubanFeedProbe() {
  const { hasMore, loading, selectorsReady } = useDoubanFeed('movie');

  return (
    <div>
      <span data-testid='has-more'>{String(hasMore)}</span>
      <span data-testid='loading'>{String(loading)}</span>
      <span data-testid='selectors-ready'>{String(selectorsReady)}</span>
    </div>
  );
}

describe('useDoubanFeed', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation();

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it('stops infinite loading when the initial Douban request fails', async () => {
    (getDoubanCategories as jest.Mock).mockRejectedValue(
      new Error('获取豆瓣分类数据失败'),
    );

    render(<DoubanFeedProbe />);

    await waitFor(() => {
      expect(getDoubanCategories).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('has-more')).toHaveTextContent('false');
    });
  });
});

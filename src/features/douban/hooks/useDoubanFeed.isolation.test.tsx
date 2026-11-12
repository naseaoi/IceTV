import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { GetBangumiCalendarDataWithMeta } from '@/features/bangumi/lib/bangumi.client';
import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { seedDefaultFeedPreview } from '@/features/douban/lib/feed-store';
import { getDoubanCategories, getDoubanRecommends } from '@/lib/douban.client';

jest.mock('@/features/bangumi/lib/bangumi.client', () => ({
  GetBangumiCalendarDataWithMeta: jest.fn(),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(),
  getDoubanList: jest.fn(),
  getDoubanRecommends: jest.fn(),
}));

function FeedProbe({ type }: { type: string }) {
  const { doubanData, isLoadingMore, loadNextPage } = useDoubanFeed(type);

  return (
    <div>
      <span data-testid='ids'>
        {doubanData.map((item) => item.id).join(',')}
      </span>
      <span data-testid='loading-more'>{String(isLoadingMore)}</span>
      <button onClick={loadNextPage}>下一页</button>
    </div>
  );
}

const item = (id: string) => ({
  id,
  title: id,
  poster: '',
  rate: '',
  year: '',
});

describe('useDoubanFeed feed isolation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not carry a paged feed into a category without cached data', async () => {
    (getDoubanCategories as jest.Mock)
      .mockResolvedValueOnce({ code: 200, message: 'ok', list: [item('tv0')] })
      .mockResolvedValueOnce({ code: 200, message: 'ok', list: [item('tv1')] });
    (getDoubanRecommends as jest.Mock).mockResolvedValue({
      code: 200,
      message: 'ok',
      list: [item('stale')],
    });
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    (GetBangumiCalendarDataWithMeta as jest.Mock).mockResolvedValue({
      data: weekdays.map((weekday) => ({
        weekday: { en: weekday },
        items: [
          { id: 100, name: 'anime', name_cn: '动画', images: { large: '' } },
          { id: 100, name: 'anime', name_cn: '动画', images: { large: '' } },
        ],
      })),
      usedStaleFallback: false,
    });

    const { rerender } = render(<FeedProbe type='tv' />);
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent('tv0'),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^tv0,tv1$/),
    );

    rerender(<FeedProbe type='anime' />);

    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^100$/),
    );
    expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(1);
    expect(getDoubanRecommends).not.toHaveBeenCalled();
  });

  it('keeps ids unique when primed data and the next page overlap', async () => {
    seedDefaultFeedPreview('show', [item('1'), item('1'), item('2')]);
    (getDoubanCategories as jest.Mock).mockImplementation(
      async ({ pageStart }: { pageStart: number }) => ({
        code: 200,
        message: 'ok',
        list: pageStart === 0 ? [item('1'), item('2')] : [item('2'), item('3')],
      }),
    );

    render(<FeedProbe type='show' />);
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^1,2$/),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^1,2,3$/),
    );
  });

  it('keeps a next page requested right after restoring cached data', async () => {
    seedDefaultFeedPreview('movie', [item('m0')]);
    let resolveNextPage: (value: unknown) => void = () => undefined;
    (getDoubanCategories as jest.Mock).mockImplementation(
      ({ pageStart }: { pageStart: number }) =>
        pageStart === 0
          ? Promise.resolve({ code: 200, message: 'ok', list: [item('m0')] })
          : new Promise((resolve) => {
              resolveNextPage = resolve;
            }),
    );

    render(<FeedProbe type='movie' />);
    expect(screen.getByTestId('ids')).toHaveTextContent(/^m0$/);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    // 让防抖后的首屏加载先于下一页响应执行
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    await act(async () => {
      resolveNextPage({ code: 200, message: 'ok', list: [item('m1')] });
    });

    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^m0,m1$/),
    );
    expect(screen.getByTestId('loading-more')).toHaveTextContent('false');
    expect(getDoubanCategories).toHaveBeenCalledTimes(2);
  });
});

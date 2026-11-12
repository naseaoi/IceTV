import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GetBangumiCalendarDataWithMeta } from '@/features/bangumi/lib/bangumi.client';
import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { getDoubanCategories } from '@/lib/douban.client';

jest.mock('@/features/bangumi/lib/bangumi.client', () => ({
  GetBangumiCalendarDataWithMeta: jest.fn(),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(),
  getDoubanList: jest.fn(),
  getDoubanRecommends: jest.fn(),
}));

function DoubanFeedProbe() {
  const { doubanData, hasMore, loading, loadFailed, retryLoad } =
    useDoubanFeed('movie');

  return (
    <div>
      <span data-testid='count'>{doubanData.length}</span>
      <span data-testid='load-failed'>{String(loadFailed)}</span>
      <button onClick={retryLoad}>重试</button>
      <span data-testid='has-more'>{String(hasMore)}</span>
      <span data-testid='loading'>{String(loading)}</span>
    </div>
  );
}

function AnimeFeedProbe({ targetWeekday }: { targetWeekday: string }) {
  const {
    doubanData,
    loading,
    selectedWeekday,
    handleWeekdayChange,
    retryLoad,
  } = useDoubanFeed('anime');

  return (
    <div>
      <button onClick={retryLoad}>重试日历</button>
      <span data-testid='anime-loading'>{String(loading)}</span>
      <span data-testid='selected-weekday'>{selectedWeekday}</span>
      <span data-testid='anime-title'>{doubanData[0]?.title || ''}</span>
      <button onClick={() => handleWeekdayChange(targetWeekday)}>
        切换日期
      </button>
    </div>
  );
}

function TvFeedProbe() {
  const { doubanData, loading, hasMore, loadNextPage } = useDoubanFeed('tv');

  return (
    <div>
      <span data-testid='tv-ids'>
        {doubanData.map((item) => item.id).join(',')}
      </span>
      <span data-testid='tv-loading'>{String(loading)}</span>
      <span data-testid='tv-has-more'>{String(hasMore)}</span>
      <button onClick={loadNextPage}>下一页</button>
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
      expect(screen.getByTestId('load-failed')).toHaveTextContent('true');
    });
  });

  it('retries a failed initial load', async () => {
    (getDoubanCategories as jest.Mock)
      .mockRejectedValueOnce(new Error('获取豆瓣分类数据失败'))
      .mockResolvedValueOnce({
        code: 200,
        message: 'ok',
        list: [{ id: '1', title: 'A', poster: '', rate: '', year: '' }],
      });

    render(<DoubanFeedProbe />);
    await waitFor(() => {
      expect(screen.getByTestId('load-failed')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1');
      expect(screen.getByTestId('load-failed')).toHaveTextContent('false');
    });
    expect(getDoubanCategories).toHaveBeenCalledTimes(2);
  });

  it('drops items already loaded when the next page overlaps', async () => {
    const item = (id: string) => ({
      id,
      title: id,
      poster: '',
      rate: '',
      year: '',
    });
    (getDoubanCategories as jest.Mock)
      .mockResolvedValueOnce({
        code: 200,
        message: 'ok',
        list: [item('1'), item('2')],
      })
      .mockResolvedValueOnce({
        code: 200,
        message: 'ok',
        list: [item('2'), item('3')],
      });

    render(<TvFeedProbe />);
    await waitFor(() => {
      expect(screen.getByTestId('tv-ids')).toHaveTextContent('1,2');
    });

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => {
      expect(screen.getByTestId('tv-ids')).toHaveTextContent(/^1,2,3$/);
    });
    expect(screen.getByTestId('tv-has-more')).toHaveTextContent('true');
  });

  it('switches Bangumi weekdays from the loaded calendar without showing loading again', async () => {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentWeekday = weekdays[new Date().getDay()];
    const targetWeekday = currentWeekday === 'Mon' ? 'Tue' : 'Mon';
    const calendarData = weekdays.map((weekday, index) => ({
      weekday: { en: weekday },
      items: [
        {
          id: index + 1,
          name: `${weekday} title`,
          name_cn: `${weekday} 标题`,
          rating: { score: 8 },
          air_date: '2026-01-01',
          images: {
            large: `https://example.com/${weekday}.jpg`,
            common: '',
            medium: '',
            small: '',
            grid: '',
          },
        },
      ],
    }));

    (GetBangumiCalendarDataWithMeta as jest.Mock).mockResolvedValue({
      data: calendarData,
      usedStaleFallback: false,
    });

    render(<AnimeFeedProbe targetWeekday={targetWeekday} />);

    await waitFor(() => {
      expect(screen.getByTestId('anime-title')).toHaveTextContent(
        `${currentWeekday} 标题`,
      );
      expect(screen.getByTestId('anime-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: '切换日期' }));

    expect(screen.getByTestId('selected-weekday')).toHaveTextContent(
      targetWeekday,
    );
    expect(screen.getByTestId('anime-title')).toHaveTextContent(
      `${targetWeekday} 标题`,
    );
    expect(screen.getByTestId('anime-loading')).toHaveTextContent('false');
    expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(1);
  });
});

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
  const { hasMore, loading, selectorsReady } = useDoubanFeed('movie');

  return (
    <div>
      <span data-testid='has-more'>{String(hasMore)}</span>
      <span data-testid='loading'>{String(loading)}</span>
      <span data-testid='selectors-ready'>{String(selectorsReady)}</span>
    </div>
  );
}

function AnimeFeedProbe({ targetWeekday }: { targetWeekday: string }) {
  const { doubanData, loading, selectedWeekday, handleWeekdayChange } =
    useDoubanFeed('anime');

  return (
    <div>
      <span data-testid='anime-loading'>{String(loading)}</span>
      <span data-testid='selected-weekday'>{selectedWeekday}</span>
      <span data-testid='anime-title'>{doubanData[0]?.title || ''}</span>
      <button onClick={() => handleWeekdayChange(targetWeekday)}>
        切换日期
      </button>
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

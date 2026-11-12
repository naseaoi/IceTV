import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const realNow = Date.now.bind(Date);
let testIndex = 0;

function calendar(idBase: number) {
  return WEEKDAYS.map((weekday, index) => ({
    weekday: { en: weekday },
    items: [
      {
        id: idBase + index,
        name: `${weekday}-${idBase}`,
        name_cn: '',
        images: { large: '' },
      },
    ],
  }));
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function FeedProbe({
  type,
  weekday = 'Mon',
}: {
  type: string;
  weekday?: string;
}) {
  const { doubanData, calendarStale, handleWeekdayChange, retryLoad } =
    useDoubanFeed(type);

  return (
    <div>
      <span data-testid='ids'>
        {doubanData.map((item) => item.id).join(',')}
      </span>
      <span data-testid='calendar-error'>{calendarStale ? 'stale' : ''}</span>
      <button onClick={retryLoad}>重试</button>
      <button onClick={() => handleWeekdayChange(weekday)}>切换星期</button>
    </div>
  );
}

const tvPage = {
  code: 200,
  message: 'ok',
  list: [{ id: 'tv0', title: 'tv0', poster: '', rate: '', year: '' }],
};

describe('useDoubanFeed Bangumi calendar', () => {
  beforeEach(() => {
    // 每个用例推后两小时，让模块级视图缓存全部过期
    testIndex += 1;
    const offset = testIndex * 2 * 60 * 60 * 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('clears the stale calendar notice after switching category', async () => {
    (GetBangumiCalendarDataWithMeta as jest.Mock).mockResolvedValue({
      data: calendar(100),
      usedStaleFallback: true,
    });
    (getDoubanCategories as jest.Mock).mockResolvedValue(tvPage);

    const { rerender } = render(<FeedProbe type='anime' />);
    await waitFor(() =>
      expect(screen.getByTestId('calendar-error')).not.toBeEmptyDOMElement(),
    );

    rerender(<FeedProbe type='tv' />);

    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^tv0$/),
    );
    expect(screen.getByTestId('calendar-error')).toBeEmptyDOMElement();
  });

  it('ignores a calendar response that arrives after leaving the category', async () => {
    const pending = deferred<unknown>();
    (GetBangumiCalendarDataWithMeta as jest.Mock).mockReturnValue(
      pending.promise,
    );
    (getDoubanCategories as jest.Mock).mockResolvedValue(tvPage);

    const { rerender } = render(<FeedProbe type='anime' />);
    await waitFor(() =>
      expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(1),
    );
    rerender(<FeedProbe type='tv' />);
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^tv0$/),
    );

    await act(async () => {
      pending.resolve({ data: calendar(100), usedStaleFallback: true });
    });

    expect(screen.getByTestId('ids')).toHaveTextContent(/^tv0$/);
    expect(screen.getByTestId('calendar-error')).toBeEmptyDOMElement();
  });

  it('keeps the newer calendar when an older weekday request resolves last', async () => {
    const today = WEEKDAYS[new Date().getDay()];
    const [first, second] = WEEKDAYS.filter((day) => day !== today);
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    (GetBangumiCalendarDataWithMeta as jest.Mock)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const { rerender } = render(<FeedProbe type='anime' weekday={first} />);
    await waitFor(() =>
      expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(1),
    );
    rerender(<FeedProbe type='anime' weekday={second} />);
    fireEvent.click(screen.getByRole('button', { name: '切换星期' }));
    await waitFor(() =>
      expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      newer.resolve({ data: calendar(200), usedStaleFallback: false });
    });
    await act(async () => {
      older.resolve({ data: calendar(100), usedStaleFallback: false });
    });
    const secondId = String(200 + WEEKDAYS.indexOf(second));
    expect(screen.getByTestId('ids')).toHaveTextContent(
      new RegExp(`^${secondId}$`),
    );

    rerender(<FeedProbe type='anime' weekday={first} />);
    fireEvent.click(screen.getByRole('button', { name: '切换星期' }));

    expect(screen.getByTestId('ids')).toHaveTextContent(
      new RegExp(`^${200 + WEEKDAYS.indexOf(first)}$`),
    );
    expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(2);
  });

  it('refetches a stale calendar on retry and clears the notice', async () => {
    (GetBangumiCalendarDataWithMeta as jest.Mock)
      .mockResolvedValueOnce({ data: calendar(100), usedStaleFallback: true })
      .mockResolvedValueOnce({ data: calendar(200), usedStaleFallback: false });

    render(<FeedProbe type='anime' />);
    await waitFor(() =>
      expect(screen.getByTestId('calendar-error')).not.toBeEmptyDOMElement(),
    );

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    const today = WEEKDAYS.indexOf(WEEKDAYS[new Date().getDay()]);
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(
        new RegExp(`^${200 + today}$`),
      ),
    );
    expect(screen.getByTestId('calendar-error')).toBeEmptyDOMElement();
    expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(2);
  });

  it('restores the chosen weekday after leaving and returning', async () => {
    const today = WEEKDAYS[new Date().getDay()];
    const other = WEEKDAYS.find((day) => day !== today) as string;
    (GetBangumiCalendarDataWithMeta as jest.Mock).mockResolvedValue({
      data: calendar(100),
      usedStaleFallback: false,
    });

    const first = render(<FeedProbe type='anime' weekday={other} />);
    await waitFor(() =>
      expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.getByTestId('ids')).not.toBeEmptyDOMElement(),
    );
    fireEvent.click(screen.getByRole('button', { name: '切换星期' }));
    const otherId = String(100 + WEEKDAYS.indexOf(other));
    expect(screen.getByTestId('ids')).toHaveTextContent(
      new RegExp(`^${otherId}$`),
    );
    first.unmount();

    render(<FeedProbe type='anime' />);

    expect(screen.getByTestId('ids')).toHaveTextContent(
      new RegExp(`^${otherId}$`),
    );
    expect(GetBangumiCalendarDataWithMeta).toHaveBeenCalledTimes(1);
  });
});

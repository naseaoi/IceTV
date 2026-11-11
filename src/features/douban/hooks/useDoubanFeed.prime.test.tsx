import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { seedDefaultFeedPreview } from '@/features/douban/lib/feed-store';
import { getDoubanCategories } from '@/lib/douban.client';

jest.mock('@/features/bangumi/lib/bangumi.client', () => ({
  GetBangumiCalendarDataWithMeta: jest.fn(),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(),
  getDoubanList: jest.fn(),
  getDoubanRecommends: jest.fn(),
}));

const realNow = Date.now.bind(Date);
let testIndex = 0;

const item = (id: string) => ({
  id,
  title: id,
  poster: '',
  rate: '',
  year: '',
});

type CategoryParams = { type: string; pageStart: number };

function mockCategoryPages(
  pages: Record<string, Record<number, string[] | Error>>,
) {
  (getDoubanCategories as jest.Mock).mockImplementation(
    async ({ type, pageStart }: CategoryParams) => {
      const page = pages[type]?.[pageStart] ?? [];
      if (page instanceof Error) throw page;
      return { code: 200, message: 'ok', list: page.map(item) };
    },
  );
}

function requestedPages() {
  return (getDoubanCategories as jest.Mock).mock.calls.map(
    ([params]: [CategoryParams]) => `${params.type}@${params.pageStart}`,
  );
}

function FeedProbe({ type }: { type: string }) {
  const { doubanData, loadNextPage, handleSecondaryChange } =
    useDoubanFeed(type);

  return (
    <div>
      <span data-testid='ids'>
        {doubanData.map((entry) => entry.id).join(',')}
      </span>
      <button onClick={loadNextPage}>下一页</button>
      <button onClick={() => handleSecondaryChange('show_domestic')}>
        国内
      </button>
    </div>
  );
}

describe('useDoubanFeed home primed pages', () => {
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

  it('keeps items that rose into the first page after the home snapshot', async () => {
    seedDefaultFeedPreview('movie', ['a', 'b', 'c'].map(item));
    mockCategoryPages({
      全部: { 0: ['x', 'a', 'b'], 25: ['c', 'd'], 50: ['e'] },
    });

    render(<FeedProbe type='movie' />);
    expect(screen.getByTestId('ids')).toHaveTextContent(/^a,b,c$/);

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^a,b,c,x,d$/),
    );

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^a,b,c,x,d,e$/),
    );
    expect(requestedPages()).toEqual(['全部@0', '全部@25', '全部@50']);
  });

  it('still loads the next page when refreshing the primed page fails', async () => {
    seedDefaultFeedPreview('movie', ['a', 'b'].map(item));
    mockCategoryPages({
      全部: { 0: new Error('offline'), 25: ['c'] },
    });

    render(<FeedProbe type='movie' />);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^a,b,c$/),
    );
  });

  it('does not let the home page reset a paged category', async () => {
    mockCategoryPages({ tv: { 0: ['t0'], 25: ['t1'] } });

    const first = render(<FeedProbe type='tv' />);
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^t0$/),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^t0,t1$/),
    );
    first.unmount();

    seedDefaultFeedPreview('tv', [item('home')]);
    render(<FeedProbe type='tv' />);

    expect(screen.getByTestId('ids')).toHaveTextContent(/^t0,t1$/);
    expect(requestedPages()).toEqual(['tv@0', 'tv@25']);
  });

  it('keeps the last selection when the home page primes the default view', async () => {
    mockCategoryPages({ show: { 0: ['s0'] }, show_domestic: { 0: ['d0'] } });

    const first = render(<FeedProbe type='show' />);
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^s0$/),
    );
    fireEvent.click(screen.getByRole('button', { name: '国内' }));
    await waitFor(() =>
      expect(screen.getByTestId('ids')).toHaveTextContent(/^d0$/),
    );
    first.unmount();

    seedDefaultFeedPreview('show', [item('home')]);
    render(<FeedProbe type='show' />);

    expect(screen.getByTestId('ids')).toHaveTextContent(/^d0$/);
  });
});

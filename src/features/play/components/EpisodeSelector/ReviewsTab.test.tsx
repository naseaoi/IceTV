import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { ReviewsTab } from '@/features/play/components/EpisodeSelector/ReviewsTab';
import type { VideoReviewsState } from '@/features/play/hooks/useVideoReviews';
import type { VideoReview } from '@/lib/types';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', username: 'alice', role: 'user' },
  }),
}));

const myReview: VideoReview = {
  title_norm: '三体',
  year: '2023',
  title: '三体',
  cover: '',
  douban_id: 0,
  rating: 8,
  content: '很好看',
  is_public: false,
  source_key: 'a+1',
  created_at: 1,
  updated_at: 1,
};

function buildState(
  overrides: Partial<VideoReviewsState> = {},
): VideoReviewsState {
  return {
    myReview: null,
    myReviewLoading: false,
    summary: { average: null, count: 0, reviews: [] },
    summaryLoading: false,
    summaryError: false,
    save: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    reloadSummary: jest.fn(),
    ...overrides,
  };
}

const baseProps = {
  workTitle: '三体',
  favorited: false,
  editRequested: false,
  onEditRequestHandled: jest.fn(),
};

describe('ReviewsTab', () => {
  it('enables saving once a rating or content is provided', () => {
    render(<ReviewsTab {...baseProps} reviews={buildState()} />);

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText('保存后将同时加入收藏')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('slider', { name: '评分' }), {
      key: 'End',
    });
    expect(saveButton).toBeEnabled();
    expect(screen.getByLabelText('分数（1.0–10.0）')).toHaveValue('10.0');
  });

  it('submits the draft and favorites first when not favorited', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const onAddFavorite = jest.fn();
    const { rerender } = render(
      <ReviewsTab
        {...baseProps}
        reviews={buildState({ save })}
        onAddFavorite={onAddFavorite}
      />,
    );

    fireEvent.change(screen.getByLabelText('评价内容'), {
      target: { value: '  值得一看  ' },
    });
    const visibility = screen.getByRole('switch', { name: '公开评价' });
    expect(visibility).toHaveTextContent('仅自己可见');
    fireEvent.click(visibility);
    expect(visibility).toHaveAttribute('aria-checked', 'true');
    expect(visibility).toHaveTextContent(/^公开$/);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });

    expect(onAddFavorite).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      rating: null,
      content: '值得一看',
      is_public: true,
    });

    rerender(
      <ReviewsTab
        {...baseProps}
        favorited
        reviews={buildState({ save, myReview })}
        onAddFavorite={onAddFavorite}
      />,
    );
    expect(screen.getByText('很好看')).toBeInTheDocument();
    expect(screen.getByText(/仅自己可见/)).toBeInTheDocument();
  });

  it('shares the draft with the expanded editor and saves with ctrl+enter', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    render(
      <ReviewsTab {...baseProps} favorited reviews={buildState({ save })} />,
    );

    fireEvent.change(screen.getByLabelText('评价内容'), {
      target: { value: '第一段' },
    });
    fireEvent.click(screen.getByRole('button', { name: '展开编辑' }));

    const dialog = await screen.findByRole('dialog', { name: '编辑评价' });
    expect(dialog).toHaveTextContent('三体');
    const fullText = screen.getByLabelText('评价全文');
    expect(fullText).toHaveValue('第一段');
    fireEvent.change(fullText, { target: { value: '第一段\n\n第二段' } });
    expect(within(dialog).getByText('8 字')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(fullText, { key: 'Enter', ctrlKey: true });
    });
    expect(save).toHaveBeenCalledWith({
      rating: null,
      content: '第一段\n\n第二段',
      is_public: false,
    });
  });

  it('collapses long review content behind an expand toggle', () => {
    render(
      <ReviewsTab
        {...baseProps}
        favorited
        reviews={buildState({
          myReview: { ...myReview, content: '长'.repeat(300) },
        })}
      />,
    );
    const toggle = screen.getByRole('button', { name: '展开全文' });
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('收起');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('requires a second click to delete the review', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    render(
      <ReviewsTab
        {...baseProps}
        favorited
        reviews={buildState({ myReview, remove })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(remove).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('opens the editor when requested from the info entry and marks own public review', () => {
    const onEditRequestHandled = jest.fn();
    render(
      <ReviewsTab
        {...baseProps}
        favorited
        editRequested
        onEditRequestHandled={onEditRequestHandled}
        reviews={buildState({
          myReview,
          summary: {
            average: 7.5,
            count: 2,
            reviews: [
              {
                username: 'alice',
                title: '三体',
                year: '2023',
                cover: '',
                rating: 8,
                content: '',
                created_at: 1,
                updated_at: 1,
              },
              {
                username: 'bob',
                title: '三体',
                year: '2023',
                cover: '',
                rating: 7,
                content: '一般',
                created_at: 1,
                updated_at: 1,
              },
            ],
          },
        })}
      />,
    );

    expect(onEditRequestHandled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByText('7.5')).toBeInTheDocument();
    expect(screen.getByText('2 人公开评分')).toBeInTheDocument();
    expect(screen.getByLabelText('7.0 分')).toBeInTheDocument();
    expect(screen.getByText('我')).toBeInTheDocument();
    expect(screen.getByText('一般')).toBeInTheDocument();
  });
});

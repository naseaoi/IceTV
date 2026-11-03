import { act, fireEvent, render, screen } from '@testing-library/react';

import PublicReviewContent from '@/components/PublicReviewContent';
import type { PublicVideoReview } from '@/lib/types';
import { reportVideoReview, setReviewLiked } from '@/lib/video-reviews.client';

jest.mock('@/lib/video-reviews.client', () => ({
  setReviewLiked: jest.fn(),
  reportVideoReview: jest.fn(),
}));
const review: PublicVideoReview = {
  author: { profileId: 'profileAlice', avatarSeed: null, nickname: '爱丽丝' },
  title_norm: '三体',
  title: '三体',
  year: '2023',
  cover: '',
  rating: 8,
  content: '结局内容',
  spoiler: true,
  likeCount: 2,
  likedByMe: false,
  created_at: 1,
  updated_at: 1,
};

beforeEach(() => jest.clearAllMocks());
it('用公开资料链接作者，剧透内容由用户主动展开', () => {
  render(<PublicReviewContent review={review} isMine={false} />);
  expect(screen.getByRole('link', { name: '爱丽丝' })).toHaveAttribute(
    'href',
    '/u/profileAlice',
  );
  expect(screen.queryByText('结局内容')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '包含剧透，点击显示' }));
  expect(screen.getByText('结局内容')).toBeInTheDocument();
});
it('点赞乐观更新，失败时恢复原有计数', async () => {
  let reject!: (reason: Error) => void;
  jest.mocked(setReviewLiked).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<PublicReviewContent review={review} isMine={false} />);
  const like = screen.getByRole('button', { name: '点赞评价' });
  fireEvent.click(like);
  expect(like).toHaveAttribute('aria-pressed', 'true');
  expect(like).toHaveTextContent('3');
  expect(like).toBeDisabled();
  await act(async () => reject(new Error('点赞失败')));
  expect(like).toHaveAttribute('aria-pressed', 'false');
  expect(like).toHaveTextContent('2');
  expect(screen.getByRole('alert')).toHaveTextContent('点赞失败');
});
it('本人评价隐藏点赞与举报入口，空昵称仍可访问主页', () => {
  render(
    <PublicReviewContent
      review={{ ...review, author: { ...review.author, nickname: null } }}
      isMine
    />,
  );
  expect(screen.getByRole('link', { name: '未设置昵称' })).toHaveAttribute(
    'href',
    '/u/profileAlice',
  );
  expect(
    screen.queryByRole('button', { name: '点赞评价' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '更多评价操作' }),
  ).not.toBeInTheDocument();
});
it('选择举报原因与说明后提交作品身份，不发送登录名', async () => {
  jest.mocked(reportVideoReview).mockResolvedValue({ ok: true });
  render(<PublicReviewContent review={review} isMine={false} />);
  fireEvent.click(screen.getByRole('button', { name: '更多评价操作' }));
  fireEvent.click(screen.getByRole('button', { name: '举报' }));
  fireEvent.click(screen.getByRole('radio', { name: '广告或垃圾内容' }));
  const detail = screen.getByRole('textbox', { name: '举报说明' });
  expect(detail).toHaveAttribute('maxlength', '200');
  fireEvent.change(detail, { target: { value: '重复广告' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
  });
  expect(reportVideoReview).toHaveBeenCalledWith(
    {
      profileId: 'profileAlice',
      title_norm: '三体',
      year: '2023',
    },
    'spam',
    '重复广告',
  );
  expect(screen.getByRole('status')).toHaveTextContent('举报已提交');
});

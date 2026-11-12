import { act, fireEvent, render, screen } from '@testing-library/react';

import PublicReviewContent from '@/components/PublicReviewContent';
import type { PublicReviewReply, PublicVideoReview } from '@/lib/types';
import { DisplayableError } from '@/lib/user-facing-error';
import {
  deleteReviewReply,
  fetchReviewReplies,
  postReviewReply,
  reportVideoReview,
  setReviewLiked,
} from '@/lib/video-reviews.client';

jest.mock('@/lib/video-reviews.client', () => ({
  setReviewLiked: jest.fn(),
  reportVideoReview: jest.fn(),
  deleteReviewReply: jest.fn(),
  fetchReviewReplies: jest.fn(),
  postReviewReply: jest.fn(),
  reportReviewReply: jest.fn(),
  REVIEW_REPLY_MAX_LENGTH: 300,
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
  replyCount: 0,
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
  await act(async () => reject(new DisplayableError('点赞失败')));
  expect(like).toHaveAttribute('aria-pressed', 'false');
  expect(like).toHaveTextContent('2');
  expect(screen.getByRole('alert')).toHaveTextContent('点赞失败');
});
it('本人评价隐藏点赞与举报入口，空昵称仍可访问主页', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: '更多评价操作' }));
  expect(
    await screen.findByRole('menuitem', { name: '回复' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('menuitem', { name: '举报' }),
  ).not.toBeInTheDocument();
});
it('选择举报原因与说明后提交作品身份，不发送登录名', async () => {
  jest.mocked(reportVideoReview).mockResolvedValue({ ok: true });
  render(<PublicReviewContent review={review} isMine={false} />);
  fireEvent.click(screen.getByRole('button', { name: '更多评价操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '举报' }));
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

const bobReply: PublicReviewReply = {
  id: 'reply-bob',
  author: { profileId: 'profileBob', avatarSeed: null, nickname: '鲍勃' },
  replyTo: null,
  content: '同意',
  created_at: 1,
  isMine: false,
};
const target = { profileId: 'profileAlice', title_norm: '三体', year: '2023' };

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

it('从更多菜单回复评价后回复出现在列表中', async () => {
  jest.mocked(postReviewReply).mockResolvedValue({
    ...bobReply,
    id: 'reply-new',
    content: '写得好',
    isMine: true,
  });
  render(<PublicReviewContent review={review} isMine={false} />);
  fireEvent.click(screen.getByRole('button', { name: '更多评价操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '回复' }));
  const input = screen.getByRole('textbox', { name: '回复内容' });
  expect(input).toHaveAttribute('placeholder', '回复 @爱丽丝');
  fireEvent.change(input, { target: { value: ' 写得好 ' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
  });
  expect(postReviewReply).toHaveBeenCalledWith(target, '写得好', undefined);
  expect(screen.getByText('写得好')).toBeInTheDocument();
  expect(
    screen.queryByRole('textbox', { name: '回复内容' }),
  ).not.toBeInTheDocument();
});

it('展开回复后可回复某条回复并带上被回复者', async () => {
  jest
    .mocked(fetchReviewReplies)
    .mockResolvedValue({ items: [bobReply], nextCursor: null });
  jest.mocked(postReviewReply).mockResolvedValue({
    ...bobReply,
    id: 'reply-new',
    replyTo: { profileId: 'profileBob', nickname: '鲍勃' },
    content: '谢谢',
    isMine: true,
  });
  render(
    <PublicReviewContent
      review={{ ...review, replyCount: 1 }}
      isMine={false}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '1 条回复' }));
  });
  expect(fetchReviewReplies).toHaveBeenCalledWith(target, undefined);
  expect(screen.getByText('同意')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '更多回复操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '回复' }));
  const input = screen.getByRole('textbox', { name: '回复内容' });
  expect(input).toHaveAttribute('placeholder', '回复 @鲍勃');
  fireEvent.change(input, { target: { value: '谢谢' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
  });
  expect(postReviewReply).toHaveBeenCalledWith(target, '谢谢', 'reply-bob');
  expect(screen.getByRole('link', { name: '@鲍勃' })).toHaveAttribute(
    'href',
    '/u/profileBob',
  );
});

it('确认后删除自己的回复并从列表移除', async () => {
  jest.mocked(fetchReviewReplies).mockResolvedValue({
    items: [{ ...bobReply, isMine: true }],
    nextCursor: null,
  });
  jest.mocked(deleteReviewReply).mockResolvedValue({ ok: true });
  render(
    <PublicReviewContent
      review={{ ...review, replyCount: 1 }}
      isMine={false}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '1 条回复' }));
  });
  fireEvent.click(screen.getByRole('button', { name: '更多回复操作' }));
  expect(
    screen.queryByRole('menuitem', { name: '举报' }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
  });
  expect(deleteReviewReply).toHaveBeenCalledWith('reply-bob');
  expect(screen.queryByText('同意')).not.toBeInTheDocument();
});

it('默认展开回复时挂载即加载回复列表', async () => {
  jest
    .mocked(fetchReviewReplies)
    .mockResolvedValue({ items: [bobReply], nextCursor: null });
  await act(async () => {
    render(
      <PublicReviewContent
        review={{ ...review, replyCount: 1 }}
        isMine={false}
        defaultRepliesExpanded
        highlightReplyId='reply-bob'
      />,
    );
  });
  expect(fetchReviewReplies).toHaveBeenCalledWith(target, undefined);
  expect(screen.getByText('同意')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '收起回复' })).toBeInTheDocument();
});
it('站长与管理员在昵称旁显示身份标识，普通用户不显示', () => {
  const { rerender } = render(
    <PublicReviewContent
      review={{ ...review, author: { ...review.author, role: 'owner' } }}
      isMine={false}
    />,
  );
  expect(screen.getByText('站长')).toBeInTheDocument();
  rerender(
    <PublicReviewContent
      review={{ ...review, author: { ...review.author, role: 'admin' } }}
      isMine={false}
    />,
  );
  expect(screen.getByText('管理员')).toBeInTheDocument();
  rerender(<PublicReviewContent review={review} isMine={false} />);
  expect(screen.queryByText('站长')).not.toBeInTheDocument();
  expect(screen.queryByText('管理员')).not.toBeInTheDocument();
});

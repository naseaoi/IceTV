import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import ProfilePageClient from '@/features/profile/ProfilePageClient';
import {
  getUserFavorites,
  getUserFollows,
  getUserProfile,
  getUserReviews,
  setFollowing,
} from '@/lib/profile.client';
import type { UserProfileView } from '@/lib/types';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span role='img' aria-label={alt} />,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: () => <span>可编辑收藏卡片</span>,
}));
jest.mock('@/lib/profile.client', () => ({
  getUserProfile: jest.fn(),
  getUserReviews: jest.fn(),
  getUserFavorites: jest.fn(),
  getUserFollows: jest.fn(),
  setFollowing: jest.fn(),
}));
const profile: UserProfileView = {
  profileId: 'profileAlice',
  nickname: '爱丽丝',
  isSelf: false,
  isFollowing: false,
  followerCount: 2,
  followingCount: 1,
  publicReviewCount: 0,
  favoritesPublic: false,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getUserProfile).mockResolvedValue(profile);
  jest
    .mocked(getUserReviews)
    .mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(getUserFavorites).mockResolvedValue({ hidden: true });
  jest.mocked(getUserFollows).mockResolvedValue({
    items: [{ profileId: 'profileBob00', nickname: '鲍勃', followedAt: 1 }],
    nextCursor: null,
  });
});
it('关注失败回滚计数与按钮，并展示服务端错误', async () => {
  let reject!: (reason: Error) => void;
  jest.mocked(setFollowing).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<ProfilePageClient profileId='profileAlice' />);
  fireEvent.click(await screen.findByRole('button', { name: '关注' }));
  expect(screen.getByRole('button', { name: '已关注' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '3 粉丝' })).toBeInTheDocument();
  await act(async () => reject(new Error('关注失败')));
  expect(screen.getByRole('button', { name: '关注' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '2 粉丝' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('关注失败');
});
it('粉丝列表可跳转主页，非公开收藏展示占位', async () => {
  render(<ProfilePageClient profileId='profileAlice' />);
  fireEvent.click(await screen.findByRole('button', { name: '2 粉丝' }));
  expect(await screen.findByRole('link', { name: '鲍勃' })).toHaveAttribute(
    'href',
    '/u/profileBob00',
  );
  expect(getUserFollows).toHaveBeenCalledWith(
    'profileAlice',
    'followers',
    null,
  );
  fireEvent.click(screen.getByRole('button', { name: '关闭列表' }));
  fireEvent.click(screen.getByRole('tab', { name: '收藏' }));
  expect(await screen.findByText('这位用户暂未公开收藏')).toBeInTheDocument();
});
it('公开收藏只读播放链接包含源标识且分页追加', async () => {
  jest
    .mocked(getUserFavorites)
    .mockResolvedValueOnce({
      hidden: false,
      items: [
        {
          key: 'a+1',
          title: '三体',
          year: '2023',
          cover: '',
          source_name: '源甲',
          total_episodes: 1,
          save_time: 1,
        },
      ],
      nextCursor: 'next',
    })
    .mockResolvedValueOnce({
      hidden: false,
      items: [
        {
          key: 'b+2',
          title: '另一部',
          year: '',
          cover: '',
          source_name: '源乙',
          total_episodes: 1,
          save_time: 1,
        },
      ],
      nextCursor: null,
    });
  render(<ProfilePageClient profileId='profileAlice' />);
  await screen.findByRole('heading', { name: '爱丽丝' });
  fireEvent.click(screen.getByRole('tab', { name: '收藏' }));
  const link = await screen.findByRole('link', { name: /三体/ });
  expect(link.getAttribute('href')).toContain('source=a&id=1');
  expect(screen.queryByText('可编辑收藏卡片')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  await waitFor(() =>
    expect(getUserFavorites).toHaveBeenLastCalledWith('profileAlice', 'next'),
  );
  expect(
    await screen.findByRole('heading', { name: '另一部' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '三体' })).toBeInTheDocument();
});

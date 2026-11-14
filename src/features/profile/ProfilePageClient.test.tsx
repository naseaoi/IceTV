import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import ProfilePageClient, {
  ProfilePageSkeleton,
} from '@/features/profile/ProfilePageClient';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  getKnownPublicReviewCount,
  getUserFavorites,
  getUserFollows,
  getUserProfile,
  getUserReviews,
  setFollowing,
} from '@/lib/profile.client';
import { showToast } from '@/lib/toast';
import type { UserProfileView } from '@/lib/types';
import { DisplayableError } from '@/lib/user-facing-error';
import { SHOWCASE_MAX_ITEMS } from '@/lib/user-profile';

jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock('@/components/card-actions/useMediaCardMenu', () => ({
  useMediaCardMenu: () => ({}),
}));
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
jest.mock('@/lib/clipboard', () => ({
  copyTextToClipboard: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
}));
jest.mock('@/lib/profile.client', () => ({
  getKnownPublicReviewCount: jest.fn(() => null),
  rememberPublicReviewCount: jest.fn(),
  getUserProfile: jest.fn(),
  getUserReviews: jest.fn(),
  getUserFavorites: jest.fn(),
  getUserFollows: jest.fn(),
  setFollowing: jest.fn(),
  updateProfile: jest.fn(),
  PROFILE_UPDATED_EVENT: 'profile:updated',
}));
const profile: UserProfileView = {
  profileId: 'profileAlice',
  avatarSeed: null,
  nickname: '爱丽丝',
  isSelf: false,
  isFollowing: false,
  followerCount: 2,
  followingCount: 1,
  publicReviewCount: 0,
  favoriteCount: 0,
  listCount: 0,
  libraryVisibility: 0,
  recap: null,
  bio: null,
  showcase: [],
  watchHours: null,
  tasteMatch: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/u/profileAlice');
  jest.mocked(getUserProfile).mockResolvedValue(profile);
  jest
    .mocked(getUserReviews)
    .mockResolvedValue({ items: [], nextCursor: null });
  jest
    .mocked(getUserFavorites)
    .mockResolvedValue({ hidden: true, libraryVisibility: 0 });
  jest.mocked(getUserFollows).mockResolvedValue({
    items: [
      {
        profileId: 'profileBob00',
        avatarSeed: null,
        nickname: '鲍勃',
        followedAt: 1,
      },
    ],
    nextCursor: null,
  });
});
it('资料加载骨架按已知公开评价数渲染，未知时只转圈', () => {
  const { unmount } = render(<ProfilePageSkeleton profileId='profileAlice' />);
  const unknown = screen.getByRole('status', { name: '加载中' });
  expect(unknown.querySelector('.ice-spinner')).not.toBeNull();
  expect(within(unknown).queryAllByRole('status')).toHaveLength(0);
  unmount();
  jest.mocked(getKnownPublicReviewCount).mockReturnValueOnce(2);
  render(<ProfilePageSkeleton profileId='profileAlice' />);
  const [known, reviews] = screen.getAllByRole('status', { name: '加载中' });
  expect(known.querySelector('.ice-spinner')).toBeNull();
  expect(reviews.children).toHaveLength(2);
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
  await act(async () => reject(new DisplayableError('关注失败')));
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
  expect(
    screen.getByRole('dialog', { name: '粉丝' }).closest('.motion-dialog'),
  ).toHaveAttribute('data-open', 'false');
  expect(screen.getByRole('link', { name: '鲍勃' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '2 粉丝' }));
  expect(await screen.findByRole('link', { name: '鲍勃' })).toBeInTheDocument();
  expect(getUserFollows).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '关闭列表' }));
  fireEvent.click(screen.getByRole('tab', { name: '收藏' }));
  expect(await screen.findByText('这位用户暂未公开收藏')).toBeInTheDocument();
});
it('关注列表首屏骨架条数跟随资料中的计数，不显示转圈', async () => {
  jest.mocked(getUserFollows).mockReturnValueOnce(new Promise(() => {}));
  render(<ProfilePageClient profileId='profileAlice' />);
  fireEvent.click(await screen.findByRole('button', { name: '2 粉丝' }));
  const dialog = await screen.findByRole('dialog', { name: '粉丝' });
  const skeleton = within(dialog).getByRole('status', { name: '加载中' });
  expect(skeleton.children).toHaveLength(2);
  expect(within(dialog).getAllByRole('status')).toHaveLength(1);
});
it('公开收藏只读播放链接包含源标识且分页追加', async () => {
  jest
    .mocked(getUserFavorites)
    .mockResolvedValueOnce({
      hidden: false,
      libraryVisibility: 1,
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
      libraryVisibility: 1,
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
    expect(getUserFavorites).toHaveBeenLastCalledWith(
      'profileAlice',
      'next',
      'all',
    ),
  );
  expect(
    await screen.findByRole('heading', { name: '另一部' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '三体' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '观看状态' })).toBeNull();
});
it('公开等级 3 按状态筛选并展示状态与评分', async () => {
  jest
    .mocked(getUserFavorites)
    .mockResolvedValueOnce({
      hidden: false,
      libraryVisibility: 3,
      items: [
        {
          key: 'douban+42',
          title: '三体',
          year: '2023',
          cover: '',
          source_name: '豆瓣',
          total_episodes: 0,
          save_time: 1,
          watchStatus: 'completed',
          rating: 8.5,
        },
        {
          key: 'a+1',
          title: '另一部',
          year: '',
          cover: '',
          source_name: '源甲',
          total_episodes: 1,
          save_time: 1,
          watchStatus: 'planned',
          rating: null,
        },
      ],
      nextCursor: null,
    })
    .mockResolvedValueOnce({
      hidden: false,
      libraryVisibility: 3,
      items: [
        {
          key: 'douban+42',
          title: '三体',
          year: '2023',
          cover: '',
          source_name: '豆瓣',
          total_episodes: 0,
          save_time: 1,
          watchStatus: 'completed',
          rating: 8.5,
        },
      ],
      nextCursor: null,
    });
  render(<ProfilePageClient profileId='profileAlice' />);
  await screen.findByRole('heading', { name: '爱丽丝' });
  fireEvent.click(screen.getByRole('tab', { name: '收藏' }));
  const link = await screen.findByRole('link', { name: /三体/ });
  expect(link.getAttribute('href')).toBe(
    '/play?title=%E4%B8%89%E4%BD%93&year=2023',
  );
  expect(screen.getByRole('img', { name: '评分 8.5 分' })).toBeInTheDocument();
  expect(screen.getByText('想看', { selector: 'a span' })).toBeInTheDocument();
  const filters = screen.getByRole('group', { name: '观看状态' });
  fireEvent.click(within(filters).getByRole('button', { name: '看过' }));
  await waitFor(() =>
    expect(getUserFavorites).toHaveBeenLastCalledWith(
      'profileAlice',
      null,
      'completed',
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '另一部' })).toBeNull(),
  );
});
it('收藏未返回时按资料中的公开等级与收藏数渲染筛选条与骨架，不叠加转圈', async () => {
  jest
    .mocked(getUserProfile)
    .mockResolvedValue({ ...profile, libraryVisibility: 2, favoriteCount: 3 });
  jest.mocked(getUserFavorites).mockReturnValue(new Promise(() => undefined));
  render(<ProfilePageClient profileId='profileAlice' />);
  await screen.findByRole('heading', { name: '爱丽丝' });
  fireEvent.click(screen.getByRole('tab', { name: '收藏' }));
  expect(screen.getByRole('group', { name: '观看状态' })).toBeInTheDocument();
  const statuses = screen.getAllByRole('status', { name: '加载中' });
  expect(statuses).toHaveLength(1);
  expect(statuses[0].children).toHaveLength(3);
});
it('资料显示无公开评价时加载期间直接给出空状态', async () => {
  jest.mocked(getUserReviews).mockReturnValue(new Promise(() => undefined));
  render(<ProfilePageClient profileId='profileAlice' />);
  await screen.findByRole('heading', { name: '爱丽丝' });
  expect(screen.getByText('还没有公开评价')).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: '加载中' })).toBeNull();
});

it('复制主页链接使用当前站点地址与资料标识，并按结果给出提示', async () => {
  jest.mocked(copyTextToClipboard).mockResolvedValueOnce(true);
  render(<ProfilePageClient profileId='profileAlice' />);

  const button = await screen.findByRole('button', { name: '复制主页链接' });
  fireEvent.click(button);
  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith('已复制主页链接', 'success'),
  );
  expect(copyTextToClipboard).toHaveBeenCalledWith(
    `${window.location.origin}/u/profileAlice`,
  );

  jest.mocked(copyTextToClipboard).mockResolvedValueOnce(false);
  fireEvent.click(button);
  await waitFor(() =>
    expect(showToast).toHaveBeenLastCalledWith(
      '复制失败，请手动复制地址栏中的链接',
      'error',
    ),
  );
});

it('他人主页展示简介、本命、观影时长与相合度，缺省时保留占位或隐藏', async () => {
  jest.mocked(getUserProfile).mockResolvedValueOnce({
    ...profile,
    bio: '深夜只看老港片',
    watchHours: 128,
    showcase: [{ key: 'src+1', title: '重庆森林', year: '1994', cover: 'c1' }],
    tasteMatch: { commonCount: 3, score: null, picks: [] },
  });
  const { unmount } = render(<ProfilePageClient profileId='profileAlice' />);
  await screen.findByText('深夜只看老港片');
  expect(screen.getByRole('link', { name: '播放重庆森林' })).toHaveAttribute(
    'href',
    '/play?title=%E9%87%8D%E5%BA%86%E6%A3%AE%E6%9E%97&year=1994',
  );
  expect(screen.getByText('观影小时')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '挑选本命作品' })).toBeNull();
  expect(
    screen.getByRole('button', { name: '共同评分 3 部' }),
  ).toBeInTheDocument();
  unmount();

  render(<ProfilePageClient profileId='profileAlice' />);
  await screen.findByRole('heading', { name: '爱丽丝' });
  expect(screen.getByText('暂无简介')).toBeInTheDocument();
  expect(screen.getByText('观影小时')).toBeInTheDocument();
  expect(screen.getByText('未公开')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '本命' })).toHaveTextContent(
    '暂无',
  );
  expect(screen.queryByText(/共同评分|口味相合|高分推荐/)).toBeNull();
});

it('本人主页空本命展示挑选入口', async () => {
  jest
    .mocked(getUserProfile)
    .mockResolvedValueOnce({ ...profile, isSelf: true, watchHours: 3 });
  render(<ProfilePageClient profileId='profileAlice' />);
  await screen.findByRole('heading', { name: '本命' });
  expect(screen.getAllByRole('button', { name: '挑选本命作品' })).toHaveLength(
    SHOWCASE_MAX_ITEMS,
  );
  expect(screen.getByRole('button', { name: '添加简介' })).toBeInTheDocument();
});
it('标签写入地址栏，带标签参数进入时直接打开对应标签', async () => {
  window.history.replaceState(null, '', '/u/profileAlice?tab=favorites');
  render(<ProfilePageClient profileId='profileAlice' />);
  expect(await screen.findByRole('tab', { name: '收藏' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.click(screen.getByRole('tab', { name: '评价' }));
  expect(window.location.search).toBe('');
  fireEvent.click(screen.getByRole('tab', { name: '收藏' }));
  expect(window.location.search).toBe('?tab=favorites');
});

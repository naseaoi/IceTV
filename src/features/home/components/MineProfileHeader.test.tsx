import { render, screen } from '@testing-library/react';

import { MineProfileHeader } from '@/features/home/components/MineProfileHeader';
import { getUserProfile } from '@/lib/profile.client';
import type { UserProfileView } from '@/lib/types';
import { fetchMyVideoReviewCount } from '@/lib/video-reviews.client';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: {
      status: 'authenticated',
      profileId: 'profileSelf1',
      nickname: '我',
      avatarSeed: null,
    },
  }),
}));
jest.mock('@/components/ProfileAvatar', () => ({
  __esModule: true,
  default: () => <span />,
}));
jest.mock('@/components/user-menu/ProfilePanel', () => ({
  ProfilePanel: () => null,
}));
jest.mock('@/features/profile/FollowList', () => ({
  FollowList: () => null,
}));
jest.mock('@/lib/profile.client', () => ({ getUserProfile: jest.fn() }));
jest.mock('@/lib/video-reviews.client', () => ({
  fetchMyVideoReviewCount: jest.fn(),
}));

const profile = {
  followingCount: 12,
  followerCount: 3,
} as UserProfileView;

it('首次加载用一位等宽数字占位，再次挂载直接展示上次的数字', async () => {
  jest.mocked(getUserProfile).mockResolvedValue(profile);
  jest.mocked(fetchMyVideoReviewCount).mockResolvedValue(7);
  const first = render(<MineProfileHeader />);
  const placeholders = first.container.querySelectorAll(
    '[aria-hidden="true"] > .invisible',
  );
  expect([...placeholders].map((node) => node.textContent)).toEqual([
    '0',
    '0',
    '0',
  ]);
  expect(await screen.findByText('12')).toBeInTheDocument();
  first.unmount();

  jest.mocked(getUserProfile).mockReturnValue(new Promise(() => undefined));
  const second = render(<MineProfileHeader />);
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(second.container.querySelector('.skeleton')).toBeNull();
});

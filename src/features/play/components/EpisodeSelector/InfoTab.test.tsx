import { render, screen } from '@testing-library/react';

import { InfoTab } from '@/features/play/components/EpisodeSelector/InfoTab';

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => (
    <div data-testid='detail-cover' aria-label={alt} />
  ),
}));

jest.mock('@/components/FavoriteHeartButton', () => ({
  FavoriteHeartButton: () => null,
}));

describe('InfoTab', () => {
  it('点播详情使用统一封面组件', () => {
    render(
      <InfoTab
        videoTitle='测试影片'
        totalEpisodes={12}
        detail={null}
        videoYear='2026'
        favorited={false}
        onToggleFavorite={jest.fn()}
        videoCover='/poster.webp'
        videoDoubanId={0}
      />,
    );

    expect(screen.getByTestId('detail-cover')).toBeInTheDocument();
  });
});

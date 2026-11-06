import { fireEvent, render, screen } from '@testing-library/react';

import type { VideoCardDisplayConfig } from '@/components/video-card/types';
import { VideoCardPoster } from '@/components/video-card/VideoCardPoster';

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

jest.mock('@/components/FavoriteHeartButton', () => ({
  FavoriteHeartButton: () => null,
}));

const config: VideoCardDisplayConfig = {
  showSourceName: true,
  showProgress: false,
  showPlayButton: false,
  showHeart: false,
  showCheckCircle: false,
  showDoubanLink: true,
  showRating: false,
  showYear: true,
};

describe('VideoCardPoster', () => {
  it('封面容器使用显式圆角裁剪以保持缩放后的圆角', () => {
    render(
      <VideoCardPoster
        title='测试影片'
        poster='/poster.webp'
        priority={false}
        origin='vod'
        from='search'
        config={config}
        visibleFavorited={false}
        onToggleFavorite={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('测试影片').parentElement).toHaveClass(
      'poster-rounded-clip',
      'overflow-hidden',
      'rounded-lg',
    );
  });

  it('有新集时左下角只显示更新状态，否则显示我的评分', () => {
    const props = {
      title: '测试影片',
      poster: '/poster.webp',
      priority: false,
      origin: 'vod' as const,
      from: 'playrecord' as const,
      config,
      myRating: 8.5,
      availableEpisodes: 13,
      visibleFavorited: false,
      onToggleFavorite: jest.fn(),
    };
    const { rerender } = render(<VideoCardPoster {...props} hasUpdate />);
    expect(screen.getByText('更新至 13 集')).toBeInTheDocument();
    expect(screen.queryByLabelText('我的评分 8.5 分')).not.toBeInTheDocument();

    rerender(<VideoCardPoster {...props} hasUpdate={false} />);
    expect(screen.getByLabelText('我的评分 8.5 分')).toHaveClass(
      'bottom-2',
      'left-2',
      'bg-black/70',
    );
  });

  it('源站名与集数角标同行排列避免重叠', () => {
    render(
      <VideoCardPoster
        title='测试影片'
        poster='/poster.webp'
        priority={false}
        origin='vod'
        from='favorite'
        config={config}
        sourceName='测试源站'
        episodes={12}
        visibleFavorited={false}
        onToggleFavorite={jest.fn()}
      />,
    );

    const badge = screen.getByTitle('测试源站');
    const episodeBadge = screen.getByText('12 集');
    expect(episodeBadge.parentElement).toBe(badge.parentElement);
    expect(badge.parentElement).toHaveClass('flex', 'justify-between');
    expect(episodeBadge).toHaveClass('shrink-0', 'bg-black/70');
  });

  it('有新集时在左下角显示更新状态', () => {
    const onMarkUpdateRead = jest.fn();
    render(
      <VideoCardPoster
        title='测试影片'
        poster='/poster.webp'
        priority={false}
        origin='vod'
        from='playrecord'
        config={config}
        episodes={13}
        currentEpisode={12}
        hasUpdate
        availableEpisodes={13}
        visibleFavorited={false}
        onToggleFavorite={jest.fn()}
        onMarkUpdateRead={onMarkUpdateRead}
      />,
    );

    const updateButton = screen.getByRole('button', {
      name: '更新至 13 集，点击标记已读',
    });
    expect(updateButton).toHaveClass('bottom-2', 'left-2', 'bg-amber-500');
    expect(screen.getByText('更新至 13 集')).toHaveClass(
      'sm:group-hover/update:hidden',
    );
    const updateCheck = updateButton.querySelector('svg');
    expect(updateCheck).toBeInTheDocument();
    expect(updateCheck?.parentElement).toHaveClass(
      'hidden',
      'sm:group-hover/update:inline',
    );
    expect(screen.queryByText('✅')).not.toBeInTheDocument();

    fireEvent.click(updateButton);
    expect(onMarkUpdateRead).toHaveBeenCalledTimes(1);
  });
});

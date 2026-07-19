import { render, screen } from '@testing-library/react';

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
  it('源站名显示在顶部行内且年份显示在左下角', () => {
    render(
      <VideoCardPoster
        title='测试影片'
        poster='/poster.webp'
        priority={false}
        origin='vod'
        from='search'
        config={config}
        sourceName='测试源站'
        year='2026'
        isBangumi={false}
        isAggregate={false}
        visibleFavorited={false}
        onDeleteRecord={jest.fn()}
        onToggleFavorite={jest.fn()}
      />,
    );

    const badge = screen.getByTitle('测试源站');
    expect(badge).toHaveClass('w-fit', 'min-w-0', 'bg-black/60');
    expect(badge.parentElement).toHaveClass('inset-x-2', 'top-2');
    expect(screen.getByText('2026')).toHaveClass('bottom-2', 'left-2');
    expect(screen.getByText('2026')).not.toHaveClass('top-2');
  });

  it('源站名与集数角标同行排列避免重叠', () => {
    render(
      <VideoCardPoster
        title='测试影片'
        poster='/poster.webp'
        priority={false}
        origin='vod'
        from='favorite'
        config={{ ...config, showDoubanLink: false, showYear: false }}
        sourceName='测试源站'
        episodes={12}
        isBangumi={false}
        isAggregate={false}
        visibleFavorited={false}
        onDeleteRecord={jest.fn()}
        onToggleFavorite={jest.fn()}
      />,
    );

    const badge = screen.getByTitle('测试源站');
    const episodeBadge = screen.getByText('12');
    expect(episodeBadge.parentElement).toBe(badge.parentElement);
    expect(badge.parentElement).toHaveClass('flex', 'justify-between');
    expect(episodeBadge).toHaveClass('flex-shrink-0');
  });
});

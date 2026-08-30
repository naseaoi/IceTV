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
        isBangumi={false}
        isAggregate={false}
        visibleFavorited={false}
        onDeleteRecord={jest.fn()}
        onToggleFavorite={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('测试影片').parentElement).toHaveClass(
      'poster-rounded-clip',
      'overflow-hidden',
      'rounded-lg',
    );
  });

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

  it('有新集时在左下角显示更新状态', () => {
    const onMarkUpdateRead = jest.fn();
    render(
      <VideoCardPoster
        title='测试影片'
        poster='/poster.webp'
        priority={false}
        origin='vod'
        from='playrecord'
        config={{ ...config, showDoubanLink: false, showYear: false }}
        episodes={13}
        currentEpisode={12}
        hasUpdate
        availableEpisodes={13}
        isBangumi={false}
        isAggregate={false}
        visibleFavorited={false}
        onDeleteRecord={jest.fn()}
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
    expect(screen.getByText('✅')).toHaveClass(
      'hidden',
      'sm:group-hover/update:inline',
    );

    fireEvent.click(updateButton);
    expect(onMarkUpdateRead).toHaveBeenCalledTimes(1);
  });
});

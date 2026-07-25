import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

  it('移动端详情滚动时更新上下柔和边缘', async () => {
    const { container } = render(
      <InfoTab
        videoTitle='测试影片'
        totalEpisodes={12}
        detail={{ desc: '测试简介' } as never}
        videoYear='2026'
        favorited={false}
        onToggleFavorite={jest.fn()}
        videoCover='/poster.webp'
        videoDoubanId={0}
        scrollMode='panel'
      />,
    );
    const panel = container.querySelector('[data-play-detail-scroll-panel]');
    expect(panel).not.toBeNull();
    Object.defineProperties(panel!, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    fireEvent.scroll(panel!);
    await waitFor(() =>
      expect(panel).toHaveAttribute('data-bottom-fade', 'true'),
    );
    expect(panel).toHaveAttribute('data-top-fade', 'false');

    panel!.scrollTop = 100;
    fireEvent.scroll(panel!);
    await waitFor(() => expect(panel).toHaveAttribute('data-top-fade', 'true'));
    expect(panel).toHaveStyle({
      maskImage:
        'linear-gradient(to bottom, transparent 0, #000 2rem, #000 calc(100% - 2rem), transparent 100%)',
    });

    panel!.scrollTop = 300;
    fireEvent.scroll(panel!);
    await waitFor(() =>
      expect(panel).toHaveAttribute('data-bottom-fade', 'false'),
    );
  });
});

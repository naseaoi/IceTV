import { render, waitFor } from '@testing-library/react';

import EpisodeSelector from '@/features/play/components/EpisodeSelector';
import { MOBILE_QUERY } from '@/hooks/useIsMobileViewport';

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function DynamicComponentStub() {
      return <div data-dynamic-component />;
    },
}));

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/features/play/components/EpisodeSelector/InfoTab', () => ({
  InfoTab: () => <div data-dynamic-component />,
}));

describe('EpisodeSelector', () => {
  afterEach(() => {
    mockSearchParams = new URLSearchParams();
  });

  it('详情加载期间显示骨架，完成后显示详情组件', async () => {
    const { container, rerender } = render(
      <EpisodeSelector totalEpisodes={0} episodes_titles={[]} detailLoading />,
    );

    expect(
      container.querySelectorAll('[data-play-detail-skeleton]'),
    ).not.toHaveLength(0);
    expect(
      container.querySelectorAll('[data-play-episodes-skeleton]'),
    ).not.toHaveLength(0);
    expect(container.querySelectorAll('[data-dynamic-component]')).toHaveLength(
      0,
    );

    rerender(
      <EpisodeSelector
        totalEpisodes={0}
        episodes_titles={[]}
        detailLoading={false}
      />,
    );

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-play-detail-skeleton]'),
      ).toHaveLength(0),
    );
    expect(
      container.querySelectorAll('[data-play-episodes-skeleton]'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-dynamic-component]'),
    ).not.toHaveLength(0);
  });

  it('评价入口参数打开评价后即从地址移除，之后换源同步地址不再重新打开', () => {
    const matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia,
    });
    window.history.replaceState(
      null,
      '',
      '/play?source=a&id=a-id&tab=reviews#top',
    );
    mockSearchParams = new URLSearchParams(window.location.search);

    const { rerender } = render(
      <EpisodeSelector totalEpisodes={0} episodes_titles={[]} />,
    );

    // 移动端评价面板按 MOBILE_QUERY 判断后打开，调用次数即打开次数
    const reviewOpens = () =>
      matchMedia.mock.calls.filter(([query]) => query === MOBILE_QUERY).length;
    expect(reviewOpens()).toBe(1);
    expect(window.location.search).toBe('?source=a&id=a-id');
    expect(window.location.hash).toBe('#top');

    window.history.replaceState(null, '', '/play?source=b&id=b-id');
    mockSearchParams = new URLSearchParams(window.location.search);
    rerender(<EpisodeSelector totalEpisodes={0} episodes_titles={[]} />);

    expect(reviewOpens()).toBe(1);
  });
});

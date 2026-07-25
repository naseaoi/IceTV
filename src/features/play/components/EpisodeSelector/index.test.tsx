import { render } from '@testing-library/react';

import EpisodeSelector from '@/features/play/components/EpisodeSelector';

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function DynamicComponentStub() {
      return <div data-dynamic-component />;
    },
}));

describe('EpisodeSelector', () => {
  it('详情加载期间显示骨架，完成后显示详情组件', () => {
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

    expect(
      container.querySelectorAll('[data-play-detail-skeleton]'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-play-episodes-skeleton]'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-dynamic-component]'),
    ).not.toHaveLength(0);
  });
});

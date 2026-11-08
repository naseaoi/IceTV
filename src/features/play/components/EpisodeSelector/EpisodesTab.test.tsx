import { fireEvent, render, screen } from '@testing-library/react';

import { EpisodesTab } from '@/features/play/components/EpisodeSelector/EpisodesTab';

describe('EpisodesTab', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: jest.fn(),
    });
  });

  it('keeps group counts and title-dependent column spans identical while loading', () => {
    const props = {
      totalEpisodes: 4,
      episodes_titles: ['简中01', '简中02', '特别篇漫长的剧集标题', '繁中02'],
      episodesPerPage: 50,
      value: 3,
      episodeGroups: [
        { label: '简中', count: 2 },
        { label: '繁中', count: 2 },
      ],
    };
    const { container, rerender } = render(<EpisodesTab {...props} loading />);
    const loadingButtons = Array.from(container.querySelectorAll('button'));
    expect(loadingButtons).toHaveLength(4);
    expect(loadingButtons.every((button) => button.disabled)).toBe(true);
    const widths = loadingButtons.map((button) => button.getAttribute('style'));
    rerender(<EpisodesTab {...props} />);
    const readyButtons = Array.from(container.querySelectorAll('button'));
    expect(readyButtons).toHaveLength(loadingButtons.length);
    expect(readyButtons.map((button) => button.getAttribute('style'))).toEqual(
      widths,
    );
    expect(container.querySelector('[data-play-episodes-skeleton]')).toBeNull();
  });

  it('shows one movie slot without fabricated pagination', () => {
    const { container } = render(
      <EpisodesTab
        loading
        totalEpisodes={1}
        episodes_titles={[]}
        episodesPerPage={50}
        value={1}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('切换分组时只更新选集目录', () => {
    const onChange = jest.fn();
    render(
      <EpisodesTab
        totalEpisodes={4}
        episodes_titles={['繁中01', '繁中02', '简中01', '简中02']}
        episodesPerPage={50}
        value={1}
        onChange={onChange}
        episodeGroups={[
          { label: '繁中', count: 2 },
          { label: '简中', count: 2 },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '简中' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTitle('简中01')).toBeInTheDocument();
    expect(screen.queryByTitle('繁中01')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('简中01'));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});

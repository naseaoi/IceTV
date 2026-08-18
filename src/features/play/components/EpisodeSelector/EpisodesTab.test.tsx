import { fireEvent, render, screen } from '@testing-library/react';

import { EpisodesTab } from '@/features/play/components/EpisodeSelector/EpisodesTab';

describe('EpisodesTab', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: jest.fn(),
    });
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

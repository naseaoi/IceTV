import { fireEvent, render, screen, within } from '@testing-library/react';

import { SourcesTab } from '@/features/play/components/EpisodeSelector/SourcesTab';
import type { SearchResult } from '@/lib/types';

const daily = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-11-${String(20 + index).padStart(2, '0')}`,
  status: 'ok' as const,
}));

const mockProbeSnapshot = new Map();

jest.mock('@/features/play/lib/sourceProbeStore', () => ({
  ...jest.requireActual('@/features/play/lib/sourceProbeStore'),
  getSnapshot: () => mockProbeSnapshot,
  subscribe: () => () => {},
  getOrProbe: jest.fn(),
}));

const mockSummary = {
  stable: {
    tier: 'good',
    playAvailability: 0.96,
    searchAvailability: 0.99,
    lastOkDate: '2026-11-26',
    daily,
  },
  plain: {
    tier: 'normal',
    playAvailability: 0.7,
    searchAvailability: 0.98,
    lastOkDate: '2026-11-26',
    daily,
  },
};

jest.mock('@/features/play/lib/sourceHealthSummary', () => ({
  useSourceHealthSummary: () => mockSummary,
}));

function createSource(source: string, name: string): SearchResult {
  return {
    id: source,
    title: 'test',
    poster: '',
    episodes: ['ep1'],
    episodes_titles: ['1'],
    source,
    source_name: name,
    year: '2026',
  };
}

describe('SourcesTab source health', () => {
  it('只为值得注意的等级显示徽标，点击查看近况且不换源', () => {
    const onSourceChange = jest.fn();
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <SourcesTab
        availableSources={[
          createSource('stable', '稳定源'),
          createSource('plain', '普通源'),
          createSource('unknown', '新源'),
        ]}
        currentSource='playing'
        currentId='other'
        videoTitle='test'
        sourceSearchLoading={false}
        sourceSearchError={null}
        onSourceChange={onSourceChange}
      />,
    );

    expect(
      screen.getAllByRole('button', { name: /^(稳定|一般|不稳|失联)$/ }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '稳定' }));

    expect(onSourceChange).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/全站近 7 天参考/)).toBeInTheDocument();
    expect(
      within(dialog).getByText('播放可用 96% · 搜索可用 99%'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('样本不足')).toBeInTheDocument();
    expect(scrollIntoView.mock.instances).toEqual([
      within(dialog).getByText('稳定源').closest('li'),
    ]);
  });
});

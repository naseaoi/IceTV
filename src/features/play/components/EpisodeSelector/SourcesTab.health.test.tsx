import { fireEvent, render, screen, within } from '@testing-library/react';

import {
  getSourceHealthChip,
  SourceHealthModal,
} from '@/features/play/components/EpisodeSelector/SourceHealthModal';
import { SourcesTab } from '@/features/play/components/EpisodeSelector/SourcesTab';
import type { SourceHealthSummary } from '@/features/play/lib/sourceHealthSummary';
import type { SourceHealthPublicTier } from '@/lib/source-quality-policy';
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

const mockSummary: SourceHealthSummary = {
  stable: {
    tier: 'good',
    playAvailability: 0.96,
    smoothRate: 0.9,
    searchAvailability: 0.99,
    lastOkDate: '2026-11-26',
    daily,
  },
  stuttering: {
    tier: 'normal',
    playAvailability: 0.96,
    smoothRate: 0.8,
    searchAvailability: 0.99,
    lastOkDate: '2026-11-26',
    daily,
  },
  plain: {
    tier: 'normal',
    playAvailability: 0.7,
    smoothRate: null,
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
  it.each<SourceHealthPublicTier>(['offline', 'poor', 'normal', 'good'])(
    '%s 等级与流畅率组合遵循单徽标优先级，弹窗独立标记卡顿',
    (tier) => {
      for (const smoothRate of [null, 0, 0.8499, 0.85, 1]) {
        const item = { ...mockSummary.plain, tier, smoothRate };
        const stuttering = smoothRate !== null && smoothRate < 0.85;
        const expected =
          tier === 'offline'
            ? '失联'
            : tier === 'poor'
              ? '不稳'
              : stuttering
                ? '卡顿多'
                : tier === 'good'
                  ? '稳定'
                  : null;
        const chip = getSourceHealthChip(item);
        expect(chip?.label ?? null).toBe(expected);
        if (expected === '卡顿多') {
          expect(chip?.className).toBe(
            getSourceHealthChip({ ...item, tier: 'poor' })?.className,
          );
        }

        const view = render(
          <SourceHealthModal
            isOpen
            onClose={jest.fn()}
            sources={[{ key: 'sample', name: '测试源' }]}
            summary={{ sample: item }}
            focusSource={null}
          />,
        );
        const row = screen.getByText('测试源').closest('li')!;
        expect(within(row).queryByText('· 卡顿多') !== null).toBe(stuttering);
        expect(row).toHaveTextContent(
          { offline: '失联', poor: '不稳', normal: '一般', good: '稳定' }[tier],
        );
        view.unmount();
      }
    },
  );

  it('缺少健康数据时省略徽标', () => {
    expect(getSourceHealthChip(undefined)).toBeNull();
  });

  it.each([
    ['stable', '稳定源', '稳定'],
    ['stuttering', '卡顿源', '卡顿多'],
  ])('点击 %s 的徽标查看近况且不换源', (key, name, label) => {
    const onSourceChange = jest.fn();
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <SourcesTab
        availableSources={[
          createSource(key, name),
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
      screen.getAllByRole('button', {
        name: /^(稳定|一般|不稳|失联|卡顿多)$/,
      }),
    ).toHaveLength(1);
    const badge = screen.getByRole('button', { name: label });
    expect(badge).toHaveAttribute('title', '全站近期参考，点击查看源站近况');
    fireEvent.click(badge);

    expect(onSourceChange).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/全站近 7 天参考/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        `播放可用 96% · 流畅 ${key === 'stable' ? 90 : 80}% · 搜索可用 99%`,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('样本不足')).toBeInTheDocument();
    expect(scrollIntoView.mock.instances).toEqual([
      within(dialog).getByText(name).closest('li'),
    ]);
  });
});

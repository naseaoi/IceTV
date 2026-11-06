import { act, fireEvent, render, screen } from '@testing-library/react';

import type { CardAction } from '@/components/card-actions/actions';
import { CardInteractionProvider } from '@/components/CardInteractionProvider';
import VideoCard from '@/components/VideoCard';
import { WatchRecordContext } from '@/components/watch-record-context';
import {
  deleteFavorite,
  getFavoriteForWork,
  saveFavorite,
} from '@/lib/db.client';
import type { SearchResult } from '@/lib/types';

jest.mock('@/components/card-actions/CardActionOverlay', () => ({
  __esModule: true,
  default: ({ isOpen, actions }: { isOpen: boolean; actions: CardAction[] }) =>
    isOpen ? (
      <div role='menu'>
        {actions.map((action) => (
          <button
            key={action.id}
            type='button'
            role='menuitem'
            disabled={action.disabled}
            onClick={() => void action.onClick()}
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null,
}));
jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));
jest.mock('@/components/modals/ConfirmModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/features/play/lib/danmaku/navigation-warmup', () => ({
  warmupDanmakuForNavigation: jest.fn(),
  warmupDanmakuSearchForNavigation: jest.fn(),
}));
jest.mock('@/hooks/useLongPress', () => ({
  useLongPress: () => ({}),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/lib/db.client', () => ({
  ...jest.requireActual('@/lib/db.client'),
  getAllFavorites: jest.fn().mockResolvedValue({}),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
  getFavoriteForWork: jest.fn(),
  saveFavorite: jest.fn(),
  deleteFavorite: jest.fn(),
}));

function result(source: string, id: string): SearchResult {
  return {
    id,
    source,
    source_name: `${source} 资源`,
    title: '三体',
    poster: `https://img.example/${source}.jpg`,
    episodes: ['1', '2', '3'],
    episodes_titles: ['1', '2', '3'],
    year: '2023',
  };
}

function renderAggregateCard(openWatchRecord = jest.fn()) {
  render(
    <WatchRecordContext.Provider value={openWatchRecord}>
      <CardInteractionProvider>
        <VideoCard
          from='search'
          isAggregate
          title='三体'
          year='2023'
          poster='https://img.example/poster.jpg'
          episodes={3}
          source_names={['alpha 资源', 'beta 资源', 'alpha 资源']}
          aggregateGroup={[result('alpha', '1'), result('beta', '2')]}
        />
      </CardInteractionProvider>
    </WatchRecordContext.Provider>,
  );
}

async function openMenu() {
  await act(async () => {
    fireEvent.contextMenu(screen.getByText('三体'));
  });
}

describe('VideoCard 多源聚合搜索结果', () => {
  beforeEach(() => {
    jest.mocked(getFavoriteForWork).mockReset();
    jest.mocked(saveFavorite).mockReset();
    jest.mocked(deleteFavorite).mockReset();
  });

  it('年份与去重后的来源数显示在标题下方', () => {
    jest.mocked(getFavoriteForWork).mockResolvedValue(null);
    renderAggregateCard();

    const subtitle = screen.getByText('2023 · 2 个源');
    expect(subtitle).toHaveAttribute('data-card-subtitle');
    expect(subtitle).toHaveAttribute('title', 'alpha 资源、beta 资源');
  });

  it('按作品身份查询收藏状态，收藏到排序第一的源', async () => {
    jest.mocked(getFavoriteForWork).mockResolvedValue(null);
    jest.mocked(saveFavorite).mockResolvedValue('alpha+1');
    renderAggregateCard();

    await openMenu();
    expect(getFavoriteForWork).toHaveBeenCalledWith({
      key: 'alpha+1',
      title: '三体',
      year: '2023',
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '加入收藏' }));
    });
    expect(saveFavorite).toHaveBeenCalledWith(
      'alpha',
      '1',
      expect.objectContaining({
        title: '三体',
        source_name: 'alpha 资源',
        year: '2023',
        cover: 'https://img.example/poster.jpg',
        total_episodes: 3,
      }),
    );
  });

  it('作品已在其他源收藏时显示取消收藏，并删除实际收藏键', async () => {
    jest.mocked(getFavoriteForWork).mockResolvedValue({
      key: 'gamma+9',
    } as Awaited<ReturnType<typeof getFavoriteForWork>>);
    renderAggregateCard();

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '取消收藏' }));
    });
    expect(deleteFavorite).toHaveBeenCalledWith('gamma', '9');
    expect(saveFavorite).not.toHaveBeenCalled();
  });

  it('标记评分以排序第一的源为目标', async () => {
    jest.mocked(getFavoriteForWork).mockResolvedValue(null);
    const openWatchRecord = jest.fn();
    renderAggregateCard(openWatchRecord);

    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '标记评分' }));
    expect(openWatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'alpha',
        id: '1',
        sourceName: 'alpha 资源',
        title: '三体',
        year: '2023',
      }),
    );
  });
});

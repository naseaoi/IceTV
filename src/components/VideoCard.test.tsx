import { act, fireEvent, render, screen } from '@testing-library/react';

import type { CardAction } from '@/components/card-actions/actions';
import { CardInteractionProvider } from '@/components/CardInteractionProvider';
import VideoCard from '@/components/VideoCard';
import { WatchRecordContext } from '@/components/watch-record-context';
import {
  deleteFavorite,
  getFavoriteForWork,
  saveFavorite,
  setFavoriteTracking,
  setPlayRecordTracking,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';
import type { SearchResult } from '@/lib/types';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

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
  default: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => Promise<void>;
  }) =>
    isOpen ? (
      <button onClick={() => void onConfirm()}>确认取消收藏</button>
    ) : null,
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
  setPlayRecordTracking: jest.fn(),
  setFavoriteTracking: jest.fn(),
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
    jest.mocked(showToast).mockClear();
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
    expect(showToast).toHaveBeenCalledWith('已加入收藏', 'success');
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
    expect(showToast).toHaveBeenCalledWith('已取消收藏', 'success');
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

it('收藏列表取消收藏等待确认，移除后不重复提示', async () => {
  jest.clearAllMocks();
  render(
    <CardInteractionProvider>
      <VideoCard from='favorite' source='src' id='1' title='三体' />
    </CardInteractionProvider>,
  );
  await openMenu();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: '取消收藏' }));
  });
  expect(showToast).not.toHaveBeenCalled();
  expect(deleteFavorite).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '确认取消收藏' }));
  });
  expect(deleteFavorite).toHaveBeenCalledWith('src', '1');
  expect(showToast).not.toHaveBeenCalled();
});

it('心形收藏按钮保持静默', async () => {
  jest.clearAllMocks();
  render(
    <CardInteractionProvider>
      <VideoCard from='playrecord' source='src' id='1' title='三体' />
    </CardInteractionProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  });
  expect(saveFavorite).toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
});

it.each([true, false])(
  '视频卡片菜单追更状态 %s 的成功反馈',
  async (trackingEnabled) => {
    jest.clearAllMocks();
    jest
      .mocked(setPlayRecordTracking)
      .mockResolvedValueOnce({ tracking_enabled: !trackingEnabled } as Awaited<
        ReturnType<typeof setPlayRecordTracking>
      >);
    render(
      <CardInteractionProvider>
        <VideoCard
          from='playrecord'
          source='src'
          id='1'
          title='三体'
          trackingEnabled={trackingEnabled}
        />
      </CardInteractionProvider>,
    );
    await openMenu();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('menuitem', {
          name: trackingEnabled ? '取消追更' : '开启追更',
        }),
      );
    });
    expect(showToast).toHaveBeenCalledWith(
      trackingEnabled ? '已取消追更' : '已开启追更',
      'success',
    );
  },
);

it.each([
  ['favorite', setFavoriteTracking, setPlayRecordTracking],
  ['record', setPlayRecordTracking, setFavoriteTracking],
] as const)(
  '收藏卡片按追更归属 %s 切换追更',
  async (trackingTarget, called, untouched) => {
    jest.clearAllMocks();
    jest
      .mocked(called)
      .mockResolvedValueOnce({ tracking_enabled: false } as never);
    render(
      <CardInteractionProvider>
        <VideoCard
          from='favorite'
          source='src'
          id='1'
          title='三体'
          trackingTarget={trackingTarget}
        />
      </CardInteractionProvider>,
    );
    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '取消追更' }));
    });
    expect(called).toHaveBeenCalledWith('src', '1', false);
    expect(untouched).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('已取消追更', 'success');
    expect(screen.queryByRole('menuitem', { name: '开启追更' })).not.toBeNull();
  },
);

it('目录或直播收藏不提供追更', async () => {
  jest.clearAllMocks();
  render(
    <CardInteractionProvider>
      <VideoCard from='favorite' source='douban' id='1' title='三体' />
    </CardInteractionProvider>,
  );
  await openMenu();
  expect(screen.queryByRole('menuitem', { name: /追更/ })).toBeNull();
});

describe('单搜索结果交接详情', () => {
  it.each([false, true])('懒解析=%s 时仅普通源写起播快照', async (lazy) => {
    const { readDetailSnapshot } =
      await import('@/features/play/lib/detailSnapshot');
    localStorage.clear();
    const detail = result('single-source', 'single-id');
    if (lazy) detail.episodes = ['icetv-lazy://giri/playGV1-1-1/'];
    render(
      <CardInteractionProvider>
        <VideoCard
          from='search'
          source={detail.source}
          id={detail.id}
          title={detail.title}
          year={detail.year}
          aggregateGroup={[detail]}
        />
      </CardInteractionProvider>,
    );
    fireEvent.click(screen.getByText('三体'));
    expect(readDetailSnapshot(detail.source, detail.id)).toEqual(
      lazy ? null : detail,
    );
  });
});

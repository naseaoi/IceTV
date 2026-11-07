import { act, fireEvent, render, screen } from '@testing-library/react';

import type { CardAction } from '@/components/card-actions/actions';
import ContinueCard from '@/components/ContinueCard';
import { useOpenWatchRecord } from '@/components/watch-record-context';
import {
  isFavorited,
  saveFavorite,
  setPlayRecordTracking,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

const showActionSheet = jest.fn();
const openWatchRecord = jest.fn();

jest.mock('@/components/watch-record-context', () => ({
  useOpenWatchRecord: jest.fn(),
}));

jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  deletePlayRecord: jest.fn(),
  isFavorited: jest.fn().mockResolvedValue(false),
  markPlayRecordUpdateRead: jest.fn(),
  saveFavorite: jest.fn(),
  setPlayRecordTracking: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/components/CardInteractionProvider', () => ({
  useCardInteractionManager: () => ({
    showActionSheet,
    showConfirm: jest.fn(),
  }),
}));

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

jest.mock('@/hooks/useLongPress', () => ({
  useLongPress: () => ({}),
}));

const baseProps = {
  source: 'source-key',
  id: 'video-id',
  title: '测试影片',
  poster: '/poster.webp',
  currentEpisode: 3,
  totalEpisodes: 12,
  progress: 50,
  resumeTime: 120,
};

describe('ContinueCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useOpenWatchRecord).mockReturnValue(openWatchRecord);
  });

  it('右键菜单按顺序包含标记评分，并传递作品信息', async () => {
    render(
      <ContinueCard
        {...baseProps}
        year='2026'
        sourceName='测试源站'
        query='搜索标题'
        hasUpdate
      />,
    );
    await act(async () => {
      fireEvent.contextMenu(
        screen.getByRole('link', { name: '继续播放 测试影片' }),
      );
    });
    const actions: CardAction[] = showActionSheet.mock.calls[0][1].actions;
    expect(actions.map(({ label }) => label)).toEqual([
      '立即播放',
      '加入收藏',
      '标记评分',
      '标为已读',
      '取消追更',
      '删除记录',
    ]);
    actions.find(({ id }) => id === 'watch-record')?.onClick();
    expect(openWatchRecord).toHaveBeenCalledWith({
      source: 'source-key',
      id: 'video-id',
      title: '测试影片',
      year: '2026',
      cover: '/poster.webp',
      sourceName: '测试源站',
      totalEpisodes: 12,
      searchTitle: '搜索标题',
    });
  });

  it('无 Provider 时隐藏标记评分', async () => {
    jest.mocked(useOpenWatchRecord).mockReturnValue(null);
    render(<ContinueCard {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    });
    const actions: CardAction[] = showActionSheet.mock.calls[0][1].actions;
    expect(actions.map(({ label }) => label)).toEqual([
      '立即播放',
      '加入收藏',
      '取消追更',
      '删除记录',
    ]);
  });

  it('有集数时在集数下方显示源站名', () => {
    render(<ContinueCard {...baseProps} sourceName='测试源站' />);

    expect(screen.getByText('第 3 集 / 共 12 集')).toHaveAttribute(
      'data-continue-meta',
    );
    expect(screen.getByText('测试源站')).toHaveAttribute(
      'data-continue-source',
    );
  });

  it('有更新时并入集数行，不额外占行', () => {
    const { container } = render(
      <ContinueCard {...baseProps} hasUpdate availableEpisodes={14} />,
    );

    expect(screen.getByText('更新至 14 集').parentElement).toHaveAttribute(
      'data-continue-meta',
    );
    expect(container.querySelectorAll('p')).toHaveLength(3);
  });

  it('没有多集信息时显示年份和源站名', () => {
    render(
      <ContinueCard
        {...baseProps}
        currentEpisode={1}
        totalEpisodes={1}
        year='2026'
        sourceName='测试源站'
      />,
    );

    expect(screen.getByText('2026')).toHaveAttribute('data-continue-meta');
    expect(screen.getByText('测试源站')).toHaveAttribute(
      'data-continue-source',
    );
  });

  it('缺少源站名称时使用源标识兜底', () => {
    render(<ContinueCard {...baseProps} sourceName='' />);

    expect(screen.getByText('source-key')).toHaveAttribute(
      'data-continue-source',
    );
  });
});

it.each([false, true])(
  '继续观看菜单收藏状态为 %s 时提示实际结果',
  async (favorited) => {
    jest.clearAllMocks();
    jest.mocked(isFavorited).mockResolvedValueOnce(favorited);
    render(<ContinueCard {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    });
    const actions: CardAction[] = showActionSheet.mock.calls[0][1].actions;
    await act(async () => {
      await actions.find(({ id }) => id === 'favorite')?.onClick();
    });
    expect(showToast).toHaveBeenCalledWith(
      favorited ? '已取消收藏' : '已加入收藏',
      'success',
    );
  },
);

it.each([false, true])(
  '继续观看菜单追更状态为 %s 时提示实际结果',
  async (trackingEnabled) => {
    jest.clearAllMocks();
    jest.mocked(setPlayRecordTracking).mockResolvedValueOnce({
      tracking_enabled: !trackingEnabled,
    } as Awaited<ReturnType<typeof setPlayRecordTracking>>);
    render(<ContinueCard {...baseProps} trackingEnabled={trackingEnabled} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    });
    const actions: CardAction[] = showActionSheet.mock.calls[0][1].actions;
    await act(async () => {
      await actions.find(({ id }) => id === 'tracking')?.onClick();
    });
    expect(showToast).toHaveBeenCalledWith(
      trackingEnabled ? '已取消追更' : '已开启追更',
      'success',
    );
  },
);

it('继续观看菜单收藏失败时不提示成功', async () => {
  jest.clearAllMocks();
  jest.mocked(saveFavorite).mockRejectedValueOnce(new Error('failed'));
  render(<ContinueCard {...baseProps} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  });
  const actions: CardAction[] = showActionSheet.mock.calls[0][1].actions;
  await expect(
    actions.find(({ id }) => id === 'favorite')?.onClick(),
  ).rejects.toThrow('failed');
  expect(showToast).not.toHaveBeenCalled();
});

import { act, fireEvent, render, screen } from '@testing-library/react';

import { PlaybackStatsPanel } from '@/features/playback-stats/components/PlaybackStatsPanel';
import {
  getCachedPlaybackPeriodSnapshot,
  getPlaybackPeriodStats,
} from '@/features/playback-stats/lib/client';
import type {
  PlaybackPeriodStats,
  PlaybackPeriodType,
  PlaybackTopWork,
} from '@/features/playback-stats/types';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/features/playback-stats/lib/client', () => ({
  getCachedPlaybackPeriodSnapshot: jest.fn(),
  getPlaybackPeriodStats: jest.fn(),
}));
jest.mock('@/lib/navigation-return', () => ({
  getCurrentNavigationPath: () => '/me',
  withReturnTo: (href: string) => href,
}));
jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: () => null,
}));
const showActionSheet = jest.fn();
jest.mock('@/components/CardInteractionProvider', () => ({
  useCardInteractionManager: () => ({
    showActionSheet,
    hideActionSheet: jest.fn(),
    showConfirm: jest.fn(),
    ensureFavoritesLoaded: () => Promise.resolve(),
    getFavoriteStatus: () => false,
  }),
  useFavoriteStatus: () => false,
}));
jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const DAYS = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
];

function work(title: string, watchSeconds: number): PlaybackTopWork {
  return {
    title,
    year: '2024',
    cover: '',
    source: 'src',
    videoId: title,
    watchSeconds,
    sessionCount: 1,
    lastWatchedAt: 0,
  };
}

function stats(
  type: PlaybackPeriodType,
  topWorks: PlaybackTopWork[],
): PlaybackPeriodStats {
  const seconds = [600, 4500, 0, 0, 0, 0, 0];
  return {
    type,
    date: '2026-11-03',
    timeZone: 'Asia/Shanghai',
    start: 0,
    end: 0,
    watchSeconds: 5100,
    activeDays: 2,
    lifetimeWatchSeconds: 80460,
    buckets: DAYS.map((key, index) => ({
      key,
      start: 0,
      end: 0,
      watchSeconds: seconds[index],
    })),
    topWorks,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCachedPlaybackPeriodSnapshot).mockReturnValue(null);
});

it('展示本周与累计，点选某天切换数值，未来日期不可点', async () => {
  jest
    .mocked(getPlaybackPeriodStats)
    .mockResolvedValue(stats('week', [work('碧蓝之海', 3000)]));
  await act(async () => {
    render(<PlaybackStatsPanel />);
  });
  expect(screen.getByText('本周')).toBeInTheDocument();
  expect(screen.getByText('累计').nextSibling).toHaveTextContent('22小时21分');
  expect(screen.getByRole('button', { name: /11月4日/ })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /11月2日/ }));
  expect(screen.getByText('11月2日').nextSibling).toHaveTextContent('10分钟');
  fireEvent.click(screen.getByRole('button', { name: /11月2日/ }));
  expect(screen.getByText('本周').nextSibling).toHaveTextContent('1小时25分');
});

it('常看切换范围时按需加载，点击海报进入播放页', async () => {
  jest
    .mocked(getPlaybackPeriodStats)
    .mockImplementation(async (type) =>
      stats(type, type === 'year' ? [work('孤独摇滚', 9000)] : []),
    );
  await act(async () => {
    render(<PlaybackStatsPanel />);
  });
  expect(screen.getByText('这周还没有看过什么')).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: '年' }));
  });
  expect(getPlaybackPeriodStats).toHaveBeenLastCalledWith('year');
  fireEvent.click(screen.getByRole('button', { name: '播放 孤独摇滚' }));
  expect(push).toHaveBeenCalledWith(
    '/play?source=src&id=%E5%AD%A4%E7%8B%AC%E6%91%87%E6%BB%9A&title=%E5%AD%A4%E7%8B%AC%E6%91%87%E6%BB%9A&year=2024',
  );
});

it('切换范围加载期间保留上一份常看，返回后替换', async () => {
  let resolveMonth: (value: PlaybackPeriodStats) => void = () => undefined;
  jest.mocked(getPlaybackPeriodStats).mockImplementation((type) =>
    type === 'month'
      ? new Promise((resolve) => {
          resolveMonth = resolve;
        })
      : Promise.resolve(stats(type, [work('碧蓝之海', 3000)])),
  );
  await act(async () => {
    render(<PlaybackStatsPanel />);
  });

  fireEvent.click(screen.getByRole('radio', { name: '月' }));
  expect(screen.getByRole('radio', { name: '月' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(
    screen.getByRole('button', { name: '播放 碧蓝之海' }),
  ).toBeInTheDocument();

  await act(async () => {
    resolveMonth(stats('month', [work('孤独摇滚', 9000)]));
  });
  expect(screen.queryByRole('button', { name: '播放 碧蓝之海' })).toBeNull();
  expect(
    screen.getByRole('button', { name: '播放 孤独摇滚' }),
  ).toBeInTheDocument();
});

it('无缓存且加载失败时给出提示', async () => {
  jest.mocked(getPlaybackPeriodStats).mockRejectedValue(new Error('boom'));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => {
    render(<PlaybackStatsPanel />);
  });
  expect(screen.getByText('统计加载失败，请稍后重试')).toBeInTheDocument();
});

it('常看海报右键在光标处打开操作菜单', async () => {
  jest
    .mocked(getPlaybackPeriodStats)
    .mockResolvedValue(stats('week', [work('碧蓝之海', 3000)]));
  await act(async () => {
    render(<PlaybackStatsPanel />);
  });

  await act(async () => {
    fireEvent.contextMenu(
      screen.getByRole('button', { name: '播放 碧蓝之海' }),
      {
        clientX: 40,
        clientY: 60,
      },
    );
  });
  const [, payload] = showActionSheet.mock.calls[0];
  expect(payload.anchorRect).toEqual({
    top: 60,
    left: 40,
    width: 0,
    height: 0,
  });
  expect(
    payload.actions.map((action: { label: string }) => action.label),
  ).toEqual(['播放', '收藏']);
});

import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  buildCardActions,
  deleteRecordAction,
  favoriteAction,
  playAction,
  summarizeSources,
} from '@/components/card-actions/actions';
import CardActionOverlay from '@/components/card-actions/CardActionOverlay';

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

function mockPointer(fine: boolean) {
  window.matchMedia = jest.fn().mockReturnValue({
    matches: fine,
    media: '(pointer: fine)',
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  });
}

const pointAnchor = { top: 100, left: 100, width: 0, height: 0 };

describe('buildCardActions', () => {
  it('按固定顺序组装全部操作并保留回调与分组', () => {
    const play = jest.fn();
    const favorite = jest.fn();
    const watchRecord = jest.fn();
    const markRead = jest.fn();
    const tracking = jest.fn();
    const remove = jest.fn();
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const actions = buildCardActions({
      remove,
      external: { url: 'https://bgm.tv/subject/1', bangumi: true },
      updates: {
        hasUpdate: true,
        onMarkRead: markRead,
        tracking: true,
        onToggleTracking: tracking,
      },
      watchRecord,
      favorite: { favorited: true, onToggle: favorite },
      play: { onClick: play, live: true },
    });

    expect(actions.map(({ id }) => id)).toEqual([
      'play',
      'favorite',
      'watch-record',
      'mark-update-read',
      'tracking',
      'external-detail',
      'delete',
    ]);
    expect(actions.map(({ label }) => label)).toEqual([
      '观看直播',
      '取消收藏',
      '标记评分',
      '标为已读',
      '取消追更',
      'Bangumi 详情',
      '删除记录',
    ]);
    expect(actions.map(({ tone }) => tone ?? 'default')).toEqual([
      ...Array(6).fill('default'),
      'danger',
    ]);
    actions.forEach((action) => action.onClick());
    [play, favorite, watchRecord, markRead, tracking, remove].forEach(
      (handler) => {
        expect(handler).toHaveBeenCalledTimes(1);
      },
    );
    expect(open).toHaveBeenCalledWith(
      'https://bgm.tv/subject/1',
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('省略缺失和 null 选项，无更新时仅保留追更', () => {
    expect(buildCardActions({})).toEqual([]);
    const actions = buildCardActions({
      watchRecord: null,
      external: null,
      updates: {
        hasUpdate: false,
        onMarkRead: jest.fn(),
        tracking: false,
        onToggleTracking: jest.fn(),
      },
    });
    expect(actions.map(({ label }) => label)).toEqual(['开启追更']);
  });

  it('收藏状态为 null 时生成禁用操作', () => {
    const actions = buildCardActions({
      favorite: { favorited: null, onToggle: jest.fn() },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: 'favorite',
      label: '加入收藏',
      disabled: true,
    });
  });
});

describe('CardActionOverlay', () => {
  const originalMatchMedia = window.matchMedia;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    jest.useFakeTimers();
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => callback(0), 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    window.matchMedia = originalMatchMedia;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('关闭动画结束前保留菜单内容', () => {
    mockPointer(true);
    const { rerender } = render(
      <CardActionOverlay
        isOpen
        onClose={jest.fn()}
        title='测试影片'
        actions={[playAction({ onClick: jest.fn() })]}
        anchorRect={pointAnchor}
      />,
    );
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(
      screen.getByRole('menuitem', { name: '立即播放' }),
    ).toBeInTheDocument();

    rerender(
      <CardActionOverlay
        isOpen={false}
        onClose={jest.fn()}
        title=''
        actions={[]}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(screen.getByRole('menu', { name: '测试影片' })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('精确指针带锚点时为菜单，仅在危险项前分隔并在点击后关闭', () => {
    mockPointer(true);
    const onClose = jest.fn();
    const onDelete = jest.fn();
    render(
      <CardActionOverlay
        isOpen
        onClose={onClose}
        title='测试影片'
        actions={[
          playAction({ onClick: jest.fn() }),
          favoriteAction(false, jest.fn()),
          deleteRecordAction(onDelete),
        ]}
        sources={['甲源', '乙源', '丙源']}
        anchorRect={pointAnchor}
      />,
    );

    expect(screen.getByRole('menu', { name: '测试影片' })).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(
      screen.getByRole('menuitem', { name: '立即播放' }),
    ).toHaveTextContent(/^立即播放$/);
    expect(screen.queryByText('测试影片')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: '删除记录' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('触屏或无锚点时为底部面板，收藏状态加载中禁用', () => {
    mockPointer(false);
    render(
      <CardActionOverlay
        isOpen
        onClose={jest.fn()}
        title='测试影片'
        sourceName='甲源'
        actions={[favoriteAction(null, jest.fn())]}
        anchorRect={pointAnchor}
      />,
    );

    expect(
      screen.getByRole('heading', { name: '测试影片' }),
    ).toBeInTheDocument();
    expect(screen.getByText('甲源')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '加入收藏' })).toBeDisabled();
  });

  it('来源摘要去重且两个以内全部列出', () => {
    expect(summarizeSources(['甲源', '甲源', '乙源'])).toBe('甲源 · 乙源');
    expect(summarizeSources([])).toBe('');
  });
});

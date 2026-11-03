import { act, fireEvent, render, screen } from '@testing-library/react';

import {
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
    expect(screen.getByRole('menuitem', { name: '播放' })).toBeInTheDocument();

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
    expect(screen.getByText('测试影片')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText('测试影片')).not.toBeInTheDocument();
  });

  it('精确指针带锚点时为菜单，按分组分隔并在点击后关闭', () => {
    mockPointer(true);
    const onClose = jest.fn();
    const onDelete = jest.fn();
    render(
      <CardActionOverlay
        isOpen
        onClose={onClose}
        title='测试影片'
        actions={[
          playAction({ onClick: jest.fn(), meta: '第 3 集' }),
          favoriteAction(false, jest.fn()),
          deleteRecordAction(onDelete),
        ]}
        sources={['甲源', '乙源', '丙源']}
        anchorRect={pointAnchor}
      />,
    );

    expect(screen.getByRole('menu', { name: '测试影片' })).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByText('第 3 集')).toBeInTheDocument();
    expect(screen.getByText('甲源 · 乙源 等 3 个源')).toBeInTheDocument();

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
    expect(screen.getByRole('menuitem', { name: '收藏' })).toBeDisabled();
  });

  it('来源摘要去重且两个以内全部列出', () => {
    expect(summarizeSources(['甲源', '甲源', '乙源'])).toBe('甲源 · 乙源');
    expect(summarizeSources([])).toBe('');
  });
});

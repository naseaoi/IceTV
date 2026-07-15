import { act, render, screen } from '@testing-library/react';

import MobileActionSheet from '@/components/MobileActionSheet';

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

describe('MobileActionSheet', () => {
  const originalMatchMedia = window.matchMedia;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    jest.useFakeTimers();
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      media: '(pointer: fine)',
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    });
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

  it('关闭动画结束前保留桌面菜单内容', () => {
    const action = {
      id: 'play',
      label: '播放',
      icon: <span>播放图标</span>,
      onClick: jest.fn(),
    };
    const { rerender } = render(
      <MobileActionSheet
        isOpen
        onClose={jest.fn()}
        title='测试影片'
        poster='/poster.webp'
        actions={[action]}
        anchorRect={{ top: 100, left: 100, width: 160, height: 240 }}
      />,
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByText('测试影片')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /播放/ })).toBeInTheDocument();

    rerender(
      <MobileActionSheet
        isOpen={false}
        onClose={jest.fn()}
        title=''
        actions={[]}
      />,
    );

    expect(screen.getByText('测试影片')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /播放/ })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(screen.getByText('测试影片')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText('测试影片')).not.toBeInTheDocument();
  });
});

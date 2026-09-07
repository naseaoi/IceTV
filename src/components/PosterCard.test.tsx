import { act, fireEvent, render } from '@testing-library/react';

import PosterCard from '@/components/PosterCard';
import {
  warmupDanmakuForNavigation,
  warmupDanmakuSearchForNavigation,
} from '@/features/play/lib/danmaku/navigation-warmup';

jest.mock('@/features/play/lib/danmaku/navigation-warmup', () => ({
  warmupDanmakuForNavigation: jest.fn(),
  warmupDanmakuSearchForNavigation: jest.fn(),
}));

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));

jest.mock('@/lib/video-prefetch', () => ({
  canUseHoverPrefetch: () => true,
  canUseNetworkPrefetch: () => true,
  findLocalPlaybackTargetByTitle: () => null,
  PREFETCH_INTENT_DELAY_MS: 20,
  transferWarmedSearchToAggregateGroup: jest.fn(),
  warmupSearchForTitle: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    prefetch: jest.fn(),
    push: jest.fn(),
  }),
}));

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

jest.mock('@/hooks/useLongPress', () => ({
  useLongPress: () => ({}),
}));

describe('PosterCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  it.each(['mouseEnter', 'focus'] as const)(
    '%s 只预热候选，点击才加载弹幕',
    (eventType) => {
      const { container } = render(
        <PosterCard title='测试影片' poster='/poster.webp' />,
      );
      const card = container.firstElementChild as HTMLElement;
      fireEvent[eventType](card);
      act(() => jest.advanceTimersByTime(25));
      expect(warmupDanmakuSearchForNavigation).toHaveBeenCalledWith('测试影片');
      expect(warmupDanmakuForNavigation).not.toHaveBeenCalled();
      fireEvent.click(card);
      expect(warmupDanmakuForNavigation).toHaveBeenCalledTimes(1);
    },
  );

  it('快速经过海报时取消预热', () => {
    const { container } = render(
      <PosterCard title='测试影片' poster='/poster.webp' />,
    );
    const card = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    act(() => jest.advanceTimersByTime(25));
    expect(warmupDanmakuSearchForNavigation).not.toHaveBeenCalled();
    expect(warmupDanmakuForNavigation).not.toHaveBeenCalled();
  });

  it('聚焦时保留卡片缩放并保持封面圆角裁剪', () => {
    const { container } = render(
      <PosterCard title='测试影片' poster='/poster.webp' />,
    );

    const card = container.firstElementChild;
    const poster = card?.firstElementChild;

    expect(card).toHaveClass('hover:scale-[1.025]');
    expect(card).toHaveClass('active:scale-[0.97]');
    expect(poster).toHaveClass(
      'poster-rounded-clip',
      'overflow-hidden',
      'rounded-lg',
    );
  });
});

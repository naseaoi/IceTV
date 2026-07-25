import { act, render, screen } from '@testing-library/react';

import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';

interface InfiniteScrollHarnessProps {
  onLoadMore: () => void;
}

function InfiniteScrollHarness({ onLoadMore }: InfiniteScrollHarnessProps) {
  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    enabled: true,
    onLoadMore,
  });

  return <div ref={sentinelRef} data-testid='sentinel' />;
}

describe('useInfiniteScroll', () => {
  const originalIntersectionObserver = global.IntersectionObserver;
  const originalResizeObserver = global.ResizeObserver;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
  const originalBodyScrollHeight = Object.getOwnPropertyDescriptor(
    document.body,
    'scrollHeight',
  );
  const originalDocumentScrollHeight = Object.getOwnPropertyDescriptor(
    document.documentElement,
    'scrollHeight',
  );
  let animationFrameId = 0;
  let animationFrames: Map<number, FrameRequestCallback>;
  let intersectionCallback: IntersectionObserverCallback;
  let observedIntersectionElements: Set<Element>;
  let observedResizeElements: Set<Element>;

  const flushAnimationFrames = () => {
    act(() => {
      const callbacks = Array.from(animationFrames.values());
      animationFrames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  };

  beforeEach(() => {
    animationFrames = new Map();
    observedIntersectionElements = new Set();
    observedResizeElements = new Set();

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(document.body, 'scrollHeight', {
      configurable: true,
      value: 5000,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 5000,
    });

    window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      animationFrameId += 1;
      animationFrames.set(animationFrameId, callback);
      return animationFrameId;
    });
    window.cancelAnimationFrame = jest.fn((id: number) => {
      animationFrames.delete(id);
    });

    global.IntersectionObserver = class IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];

      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      disconnect() {
        observedIntersectionElements.clear();
      }

      observe(element: Element) {
        observedIntersectionElements.add(element);
      }

      takeRecords() {
        return [];
      }

      unobserve(element: Element) {
        observedIntersectionElements.delete(element);
      }
    };

    global.ResizeObserver = class ResizeObserver {
      disconnect() {
        observedResizeElements.clear();
      }

      observe(element: Element) {
        observedResizeElements.add(element);
      }

      unobserve(element: Element) {
        observedResizeElements.delete(element);
      }
    };

    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 4020,
      height: 20,
      left: 0,
      right: 100,
      top: 4000,
      width: 100,
      x: 0,
      y: 4000,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    global.IntersectionObserver = originalIntersectionObserver;
    global.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;

    if (originalScrollY) {
      Object.defineProperty(window, 'scrollY', originalScrollY);
    }
    if (originalBodyScrollHeight) {
      Object.defineProperty(
        document.body,
        'scrollHeight',
        originalBodyScrollHeight,
      );
    }
    if (originalDocumentScrollHeight) {
      Object.defineProperty(
        document.documentElement,
        'scrollHeight',
        originalDocumentScrollHeight,
      );
    }

    jest.restoreAllMocks();
  });

  it('使用真实滚动事件触发加载，不创建常驻轮询', () => {
    const timeoutSpy = jest.spyOn(window, 'setTimeout');
    const onLoadMore = jest.fn();

    render(<InfiniteScrollHarness onLoadMore={onLoadMore} />);
    flushAnimationFrames();

    expect(onLoadMore).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(observedResizeElements).toEqual(
      new Set([
        document.documentElement,
        document.body,
        screen.getByTestId('sentinel'),
      ]),
    );

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 4300,
    });

    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    flushAnimationFrames();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('保留交叉观察器触发加载', () => {
    const onLoadMore = jest.fn();

    render(<InfiniteScrollHarness onLoadMore={onLoadMore} />);
    flushAnimationFrames();

    const sentinel = screen.getByTestId('sentinel');
    expect(observedIntersectionElements.has(sentinel)).toBe(true);

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

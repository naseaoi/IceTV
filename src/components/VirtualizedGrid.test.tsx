import { act, render } from '@testing-library/react';

import { VirtualizedGrid } from '@/components/VirtualizedGrid';

interface ResizeObserverRecord {
  callback: ResizeObserverCallback;
  elements: Set<Element>;
}

describe('VirtualizedGrid', () => {
  const originalResizeObserver = global.ResizeObserver;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  let animationFrameId = 0;
  let animationFrames: Map<number, FrameRequestCallback>;
  let resizeObservers: ResizeObserverRecord[];

  const flushAnimationFrames = () => {
    act(() => {
      const callbacks = Array.from(animationFrames.values());
      animationFrames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  };

  beforeEach(() => {
    animationFrames = new Map();
    resizeObservers = [];

    window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      animationFrameId += 1;
      animationFrames.set(animationFrameId, callback);
      return animationFrameId;
    });
    window.cancelAnimationFrame = jest.fn((id: number) => {
      animationFrames.delete(id);
    });

    global.ResizeObserver = class ResizeObserver {
      private readonly record: ResizeObserverRecord;

      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, elements: new Set() };
        resizeObservers.push(this.record);
      }

      disconnect() {
        this.record.elements.clear();
      }

      observe(element: Element) {
        this.record.elements.add(element);
      }

      unobserve(element: Element) {
        this.record.elements.delete(element);
      }
    };

    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 500,
      height: 300,
      left: 0,
      right: 900,
      top: 200,
      width: 900,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    jest.restoreAllMocks();
  });

  it('通过滚动和尺寸变化更新视口，不创建常驻轮询', () => {
    const timeoutSpy = jest.spyOn(window, 'setTimeout');
    const items = Array.from({ length: 60 }, (_, index) => ({
      id: String(index),
    }));

    render(
      <VirtualizedGrid
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.id}</span>}
        fallbackClassName='grid'
      />,
    );

    flushAnimationFrames();

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(
      resizeObservers.some(
        ({ elements }) =>
          elements.has(document.documentElement) && elements.has(document.body),
      ),
    ).toBe(true);

    const frameCountBeforeScroll = (window.requestAnimationFrame as jest.Mock)
      .mock.calls.length;

    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(
      frameCountBeforeScroll + 1,
    );
    flushAnimationFrames();

    const viewportObserver = resizeObservers.find(({ elements }) =>
      elements.has(document.body),
    );
    const frameCountBeforeResize = (window.requestAnimationFrame as jest.Mock)
      .mock.calls.length;

    act(() => {
      viewportObserver?.callback([], {} as ResizeObserver);
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(
      frameCountBeforeResize + 1,
    );
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});

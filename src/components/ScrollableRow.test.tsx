import { act, fireEvent, render } from '@testing-library/react';

import ScrollableRow from '@/components/ScrollableRow';

describe('ScrollableRow', () => {
  const originalResizeObserver = global.ResizeObserver;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth',
  );
  const originalScrollWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollWidth',
  );
  let animationFrameId = 0;
  let animationFrames: Map<number, FrameRequestCallback>;

  const flushAnimationFrames = () => {
    act(() => {
      const callbacks = Array.from(animationFrames.values());
      animationFrames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  };

  beforeEach(() => {
    animationFrames = new Map();

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('overflow-x-auto') ? 300 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this.classList.contains('overflow-x-auto')
          ? this.children.length * 180 + 400
          : 0;
      },
    });

    window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      animationFrameId += 1;
      animationFrames.set(animationFrameId, callback);
      return animationFrameId;
    });
    window.cancelAnimationFrame = jest.fn((id: number) => {
      animationFrames.delete(id);
    });

    global.ResizeObserver = class ResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      disconnect() {}
      observe() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;

    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientWidth',
        originalClientWidth,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
    if (originalScrollWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollWidth',
        originalScrollWidth,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
    }

    jest.restoreAllMocks();
  });

  it('只挂载首批卡片，并在横向滚动接近末端时追加', () => {
    const { container } = render(
      <ScrollableRow initialItemCount={2} mountBatchSize={2}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index}>卡片 {index}</div>
        ))}
      </ScrollableRow>,
    );

    const scroller = container.querySelector('.overflow-x-auto');
    expect(scroller).not.toBeNull();
    expect(scroller?.children).toHaveLength(2);

    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      value: 500,
      writable: true,
    });
    fireEvent.scroll(scroller as HTMLElement);
    flushAnimationFrames();

    expect(scroller?.children).toHaveLength(4);
  });
});

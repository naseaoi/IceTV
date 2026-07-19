import { act, fireEvent, render, screen } from '@testing-library/react';

import CapsuleSwitch from '@/components/CapsuleSwitch';

describe('CapsuleSwitch', () => {
  const originalResizeObserver = global.ResizeObserver;
  let resizeCallback: ResizeObserverCallback;

  beforeEach(() => {
    global.ResizeObserver = class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      disconnect() {}
      observe() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  it('recalculates the active indicator after the layout becomes visible', () => {
    const { container } = render(
      <CapsuleSwitch
        options={[
          { label: '首页', value: 'home' },
          { label: '我的', value: 'mine' },
        ]}
        active='mine'
        onChange={jest.fn()}
      />,
    );

    const switchContainer = container.firstElementChild as HTMLDivElement;
    const mineButton = screen.getByRole('button', { name: '我的' });
    switchContainer.getBoundingClientRect = () =>
      ({ left: 20, width: 200 }) as DOMRect;
    mineButton.getBoundingClientRect = () =>
      ({ left: 120, width: 80 }) as DOMRect;

    act(() => {
      resizeCallback([], {} as ResizeObserver);
    });

    const indicator = container.querySelector<HTMLElement>(
      '[data-capsule-indicator]',
    );
    expect(indicator).toHaveStyle({ left: '100px', width: '80px' });
  });

  it('keeps option clicks working while observing layout changes', () => {
    const onChange = jest.fn();
    render(
      <CapsuleSwitch
        options={[
          { label: '首页', value: 'home' },
          { label: '我的', value: 'mine' },
        ]}
        active='home'
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '我的' }));
    expect(onChange).toHaveBeenCalledWith('mine');
  });
});

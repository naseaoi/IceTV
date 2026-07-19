import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ThemeToggle } from '@/components/ThemeToggle';

const setTheme = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

jest.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'dark',
    setTheme,
  }),
}));

describe('ThemeToggle', () => {
  const originalStartViewTransition = document.startViewTransition;
  const originalAnimate = document.documentElement.animate;
  const originalMatchMedia = window.matchMedia;
  const originalVisualViewport = window.visualViewport;
  const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(
    window,
    'devicePixelRatio',
  );
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    document.documentElement,
    'clientWidth',
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    document.documentElement,
    'clientHeight',
  );

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: originalStartViewTransition,
    });
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      value: originalAnimate,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
    if (originalDevicePixelRatio) {
      Object.defineProperty(
        window,
        'devicePixelRatio',
        originalDevicePixelRatio,
      );
    } else {
      Reflect.deleteProperty(window, 'devicePixelRatio');
    }
    if (originalClientWidth) {
      Object.defineProperty(
        document.documentElement,
        'clientWidth',
        originalClientWidth,
      );
    } else {
      Reflect.deleteProperty(document.documentElement, 'clientWidth');
    }
    if (originalClientHeight) {
      Object.defineProperty(
        document.documentElement,
        'clientHeight',
        originalClientHeight,
      );
    } else {
      Reflect.deleteProperty(document.documentElement, 'clientHeight');
    }
    document.documentElement.style.removeProperty('--theme-transition-x');
    document.documentElement.style.removeProperty('--theme-transition-y');
    document.documentElement.style.removeProperty('--theme-transition-radius');
  });

  it('uses viewport-relative coordinates at high device pixel ratios', async () => {
    const animate = jest.fn(() => ({}) as Animation);
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => void) => {
        callback();
        return { ready: Promise.resolve() };
      },
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { offsetLeft: 5, offsetTop: 7 },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 800 },
    });

    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: '切换主题' });
    const anchor = button.querySelector('[data-theme-transition-anchor]');
    expect(anchor).not.toBeNull();
    anchor!.getBoundingClientRect = () =>
      ({
        left: 300,
        top: 4,
        width: 40,
        height: 40,
      }) as DOMRect;

    fireEvent.click(button);

    expect(setTheme).toHaveBeenCalledWith('light');
    expect(
      document.documentElement.style.getPropertyValue('--theme-transition-x'),
    ).toBe('81.25%');
    expect(
      document.documentElement.style.getPropertyValue('--theme-transition-y'),
    ).toBe('3.875%');
    expect(
      document.documentElement.style.getPropertyValue(
        '--theme-transition-radius',
      ),
    ).toBe(`${(Math.hypot(325, 769) / 800) * 100}vmax`);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1));
  });
});

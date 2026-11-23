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
    jest.restoreAllMocks();
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
    let finishTransition!: () => void;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    const animate = jest.fn(
      () => ({ finished: Promise.resolve() }) as unknown as Animation,
    );
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => void) => {
        callback();
        return {
          ready: Promise.resolve(),
          finished: transitionFinished,
        } as ViewTransition;
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

    finishTransition();
    await waitFor(() =>
      expect(
        document.documentElement.style.getPropertyValue(
          '--theme-transition-radius',
        ),
      ).toBe(''),
    );
  });

  it('keeps live regions out of the page snapshot and reveals overlays in sync', async () => {
    let finishTransition!: () => void;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    const animate = jest.fn(
      () => ({ finished: Promise.resolve() }) as unknown as Animation,
    );
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      value: animate,
    });
    // jsdom 会丢弃不认识的 view-transition-name，按调用记录元素当前的名称
    const transitionNames = new Map<CSSStyleDeclaration, string>();
    jest
      .spyOn(CSSStyleDeclaration.prototype, 'setProperty')
      .mockImplementation(function (this: CSSStyleDeclaration, name, value) {
        if (name === 'view-transition-name') {
          transitionNames.set(this, String(value));
        }
      });
    jest
      .spyOn(CSSStyleDeclaration.prototype, 'removeProperty')
      .mockImplementation(function (this: CSSStyleDeclaration, name) {
        if (name === 'view-transition-name') transitionNames.delete(this);
        return '';
      });
    const nameOf = (testId: string) =>
      transitionNames.get(screen.getByTestId(testId).style) ?? '';
    let namesAtCapture: string[] = [];
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => void) => {
        namesAtCapture = ['live', 'hidden-live', 'reveal'].map(nameOf);
        callback();
        return {
          ready: Promise.resolve(),
          finished: transitionFinished,
        } as ViewTransition;
      },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 800 },
    });

    render(
      <>
        <div data-testid='live' data-theme-transition='live' />
        <div data-testid='hidden-live' data-theme-transition='live' />
        <div data-testid='reveal' data-theme-transition='reveal' />
        <ThemeToggle />
      </>,
    );
    const box =
      (left: number, top: number, width: number, height: number) => () =>
        ({ left, top, width, height }) as DOMRect;
    screen.getByTestId('live').getBoundingClientRect = box(0, 0, 200, 100);
    screen.getByTestId('hidden-live').getBoundingClientRect = box(0, 0, 0, 0);
    screen.getByTestId('reveal').getBoundingClientRect = box(110, 0, 300, 400);
    const button = screen.getByRole('button', { name: '切换主题' });
    button.querySelector<HTMLElement>(
      '[data-theme-transition-anchor]',
    )!.getBoundingClientRect = box(340, 20, 20, 20);

    fireEvent.click(button);

    expect(namesAtCapture).toEqual(['theme-live-0', '', 'theme-reveal-0']);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
    expect(animate).toHaveBeenLastCalledWith(
      {
        clipPath: [
          'circle(0% at 80% 7.5%)',
          `circle(${(Math.hypot(350, 770) / (500 / Math.SQRT2)) * 100}% at 80% 7.5%)`,
        ],
      },
      expect.objectContaining({
        pseudoElement: '::view-transition-new(theme-reveal-0)',
      }),
    );

    finishTransition();
    await waitFor(() => expect(nameOf('live')).toBe(''));
    expect(nameOf('reveal')).toBe('');
  });

  it('ignores repeated clicks until the current transition finishes', async () => {
    let finishTransition!: () => void;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      value: jest.fn(
        () => ({ finished: Promise.resolve() }) as unknown as Animation,
      ),
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => void) => {
        callback();
        return {
          ready: Promise.resolve(),
          finished: transitionFinished,
        } as ViewTransition;
      },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 800 },
    });

    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: '切换主题' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(setTheme).toHaveBeenCalledTimes(1);

    finishTransition();
    await waitFor(() =>
      expect(
        document.documentElement.style.getPropertyValue(
          '--theme-transition-radius',
        ),
      ).toBe(''),
    );
  });
});

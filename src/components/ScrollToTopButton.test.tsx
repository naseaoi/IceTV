import { fireEvent, render, screen } from '@testing-library/react';

import { ScrollToTopButton } from './ScrollToTopButton';

describe('ScrollToTopButton', () => {
  const originalScrollTo = window.scrollTo;
  const originalBodyScrollTo = document.body.scrollTo;
  const originalDocumentScrollTo = document.documentElement.scrollTo;

  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      writable: true,
      value: 0,
    });
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    window.scrollTo = jest.fn();
    document.body.scrollTo = jest.fn();
    document.documentElement.scrollTo = jest.fn();
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    document.body.scrollTo = originalBodyScrollTo;
    document.documentElement.scrollTo = originalDocumentScrollTo;
  });

  it('滚动超过阈值后显示并支持回顶', () => {
    render(<ScrollToTopButton />);

    const button = screen.getByRole('button', { name: '返回顶部' });

    expect(button).toHaveClass('pointer-events-none');

    document.body.scrollTop = 500;
    fireEvent.scroll(document.body);

    expect(button).toHaveClass('pointer-events-auto');

    fireEvent.click(button);

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    });
    expect(document.body.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    });
    expect(document.body.scrollTop).toBe(500);
  });

  it('缺少元素滚动方法时使用直接回顶兜底', () => {
    document.body.scrollTo =
      undefined as unknown as typeof document.body.scrollTo;
    document.documentElement.scrollTo =
      undefined as unknown as typeof document.documentElement.scrollTo;
    document.body.scrollTop = 500;

    render(<ScrollToTopButton />);

    fireEvent.scroll(document.body);
    fireEvent.click(screen.getByRole('button', { name: '返回顶部' }));

    expect(document.body.scrollTop).toBe(0);
  });
});

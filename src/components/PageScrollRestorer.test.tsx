import { render } from '@testing-library/react';
import { usePathname } from 'next/navigation';

import { PageScrollRestorer } from '@/components/PageScrollRestorer';
import { scrollPageTo } from '@/hooks/usePageScroll';

jest.mock('next/navigation', () => ({ usePathname: jest.fn() }));
jest.mock('@/hooks/usePageScroll', () => ({
  getPageScrollTop: () => document.body.scrollTop,
  scrollPageTo: jest.fn((top: number) => {
    document.body.scrollTop = top;
  }),
  subscribePageScroll: (listener: () => void) => {
    document.body.addEventListener('scroll', listener);
    return () => document.body.removeEventListener('scroll', listener);
  },
}));

function scrollTo(top: number) {
  document.body.scrollTop = top;
  document.body.dispatchEvent(new Event('scroll'));
}

function navigate(view: ReturnType<typeof render>, path: string, pop = false) {
  window.history.pushState(null, '', path);
  if (pop) window.dispatchEvent(new PopStateEvent('popstate'));
  jest.mocked(usePathname).mockReturnValue(path);
  view.rerender(<PageScrollRestorer />);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  document.body.scrollTop = 0;
  jest.mocked(usePathname).mockReturnValue('/');
});

it('首次挂载不改动滚动位置', () => {
  document.body.scrollTop = 120;
  render(<PageScrollRestorer />);
  expect(scrollPageTo).not.toHaveBeenCalled();
});

it('新页面回到顶部，前进后退恢复离开时的位置', () => {
  const view = render(<PageScrollRestorer />);
  scrollTo(900);
  navigate(view, '/me');
  expect(scrollPageTo).toHaveBeenLastCalledWith(0);
  scrollTo(300);
  navigate(view, '/', true);
  expect(scrollPageTo).toHaveBeenLastCalledWith(900);
  navigate(view, '/me', true);
  expect(scrollPageTo).toHaveBeenLastCalledWith(300);
});

it('同路径仅查询参数变化时不干预', () => {
  const view = render(<PageScrollRestorer />);
  scrollTo(500);
  window.history.replaceState(null, '', '/?source=a');
  view.rerender(<PageScrollRestorer />);
  expect(scrollPageTo).not.toHaveBeenCalled();
});

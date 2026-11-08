import { fireEvent, render, screen } from '@testing-library/react';

import MobileBottomNav from '@/components/MobileBottomNav';

const mockPathname = jest.fn(() => '/continue-watching');
const mockScrollPageToTop = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

jest.mock('@/hooks/useIntentPrefetch', () => ({
  useIntentPrefetch: () => jest.fn(),
}));

jest.mock('@/components/user-menu/account', () => ({
  useHasUpdate: () => false,
}));

jest.mock('@/hooks/usePageScroll', () => ({
  scrollPageToTop: () => mockScrollPageToTop(),
}));

describe('MobileBottomNav', () => {
  beforeEach(() => {
    mockScrollPageToTop.mockClear();
  });

  it('highlights Home on the continue-watching page', () => {
    render(<MobileBottomNav />);

    expect(screen.getByLabelText('首页')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByLabelText('我的')).not.toHaveAttribute('aria-current');
  });

  it('highlights 我的 on settings and public profile pages', () => {
    for (const pathname of ['/settings', '/u/abc']) {
      mockPathname.mockReturnValue(pathname);
      const { unmount } = render(<MobileBottomNav />);
      expect(screen.getByLabelText('我的')).toHaveAttribute(
        'aria-current',
        'page',
      );
      unmount();
    }
  });

  it('scrolls to top when tapping the current tab', () => {
    mockPathname.mockReturnValue('/search');
    render(<MobileBottomNav />);

    fireEvent.click(screen.getByLabelText('搜索'));
    expect(mockScrollPageToTop).toHaveBeenCalledTimes(1);
  });
});

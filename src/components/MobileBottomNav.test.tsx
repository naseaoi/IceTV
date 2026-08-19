import { render, screen } from '@testing-library/react';

import MobileBottomNav from '@/components/MobileBottomNav';

jest.mock('next/navigation', () => ({
  usePathname: () => '/continue-watching',
}));

jest.mock('@/hooks/useIntentPrefetch', () => ({
  useIntentPrefetch: () => jest.fn(),
}));

describe('MobileBottomNav', () => {
  it('highlights Home on the continue-watching page', () => {
    render(<MobileBottomNav />);

    expect(screen.getByLabelText('首页')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByLabelText('我的')).not.toHaveAttribute('aria-current');
  });
});

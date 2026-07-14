import { render } from '@testing-library/react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';

describe('ContinueWatchingCardSkeleton', () => {
  it('分别提供移动端横卡和桌面端海报骨架', () => {
    const { container } = render(<ContinueWatchingCardSkeleton />);
    const mobileSkeleton = container.querySelector(
      '[data-mobile-continue-skeleton]',
    );
    const mobileContainer = mobileSkeleton?.parentElement;
    const desktopContainer = mobileContainer?.nextElementSibling;

    expect(mobileContainer).toHaveClass('md:hidden');
    expect(desktopContainer).toHaveClass('hidden', 'md:block');
    expect(mobileSkeleton).toHaveClass('h-[120px]', 'w-[232px]');
    expect(desktopContainer?.firstElementChild).toHaveClass(
      'w-[25vw]',
      'sm:w-44',
    );
  });
});

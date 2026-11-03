import { render } from '@testing-library/react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';

describe('ContinueWatchingCardSkeleton', () => {
  it('与横版继续观看卡片同尺寸', () => {
    const { container } = render(<ContinueWatchingCardSkeleton />);
    const skeleton = container.querySelector('[data-continue-skeleton]');

    expect(skeleton).toHaveClass(
      'h-[120px]',
      'w-[232px]',
      'md:h-[136px]',
      'md:w-[340px]',
    );
  });
});

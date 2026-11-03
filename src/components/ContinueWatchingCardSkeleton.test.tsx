import { render } from '@testing-library/react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';

describe('ContinueWatchingCardSkeleton', () => {
  it('与横版继续观看卡片同尺寸', () => {
    const { container } = render(<ContinueWatchingCardSkeleton />);
    const skeleton = container.querySelector('[data-continue-skeleton]');

    expect(skeleton).toHaveClass('w-[236px]', 'md:w-[288px]');
    expect(skeleton?.firstElementChild).toHaveClass(
      'aspect-[2/3]',
      'w-[76px]',
      'md:w-[88px]',
    );
  });
});
